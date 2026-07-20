const deploymentTtl = () => new Date(Date.now() + 30 * 60_000);

const retry = async (operation, description, maxAttempts = 3) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[deploy] retrying ${description} (${attempt}/${maxAttempts}): ${reason}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
};

export const deployContractPhased = async ({
  providers,
  compiledContract,
  privateStateId,
  initialPrivateState,
  args,
  compactJs,
  midnightTypes,
  ledgerApi,
  midnightContracts,
  networkIdApi,
  operationVersion,
}) => {
  if (operationVersion !== 'v3' && operationVersion !== 'v4') {
    throw new Error(`Unsupported contract operation version: ${operationVersion}`);
  }
  const signingKey = ledgerApi.sampleSigningKey();
  const contractExecutable = compactJs.ContractExecutable.make(compiledContract);
  const runtime = midnightTypes.makeContractExecutableRuntime(
    providers.zkConfigProvider,
    {
      coinPublicKey: providers.walletProvider.getCoinPublicKey().toString(),
      signingKey,
    },
  );

  console.log('[deploy] deriving initial state');
  const exit = await runtime.runPromiseExit(
    contractExecutable.initialize(initialPrivateState, ...args),
  );
  const initialized = midnightTypes.exitResultOrError(exit);
  const fullState = ledgerApi.ContractState.deserialize(
    initialized.public.contractState.serialize(),
  );
  const strippedState = new ledgerApi.ContractState();
  strippedState.data = fullState.data;
  strippedState.maintenanceAuthority = fullState.maintenanceAuthority;

  const contractDeploy = new ledgerApi.ContractDeploy(strippedState);
  const contractAddress = contractDeploy.address;
  const ttl = deploymentTtl();
  const unprovenTransaction = ledgerApi.Transaction.fromParts(
    networkIdApi.getNetworkId(),
    undefined,
    undefined,
    ledgerApi.Intent.new(ttl).addDeploy(contractDeploy),
  );

  console.log(`[deploy] submitting base contract=${contractAddress} circuits=0`);
  const finalizedTransaction = await providers.walletProvider.balanceUnprovenTx(
    unprovenTransaction,
    ttl,
  );
  const transactionId = await providers.midnightProvider.submitTx(
    finalizedTransaction,
  );
  const deployTxData = await providers.publicDataProvider.watchForTxData(
    transactionId,
  );
  if (deployTxData.status !== midnightTypes.SucceedEntirely) {
    throw new Error(`Base deployment failed with status ${deployTxData.status}.`);
  }

  providers.privateStateProvider.setContractAddress(contractAddress);
  await providers.privateStateProvider.set(
    privateStateId,
    initialized.private.privateState,
  );
  await providers.privateStateProvider.setSigningKey(
    contractAddress,
    initialized.private.signingKey,
  );

  const circuitIds = contractExecutable.getProvableCircuitIds().sort();
  const verifierKeys = await providers.zkConfigProvider.getVerifierKeys(
    circuitIds,
  );
  console.log(
    `[deploy] base contract accepted; inserting ${verifierKeys.length} verifier keys`,
  );
  for (const [index, [circuitId, verifierKey]] of verifierKeys.entries()) {
    await retry(
      async () => {
        const currentState =
          await providers.publicDataProvider.queryContractState(contractAddress);
        if (currentState === null) {
          throw new Error(`Contract ${contractAddress} is not indexed.`);
        }
        if (currentState.operation(circuitId) !== undefined) return;

        const currentSigningKey =
          await providers.privateStateProvider.getSigningKey(contractAddress);
        if (currentSigningKey === null) {
          throw new Error(
            `Maintenance signing key for ${contractAddress} is unavailable.`,
          );
        }
        const versionedVerifierKey =
          new ledgerApi.ContractOperationVersionedVerifierKey(
            operationVersion,
            verifierKey,
          );
        const insert = new ledgerApi.VerifierKeyInsert(
          circuitId,
          versionedVerifierKey,
        );
        const unsignedUpdate = new ledgerApi.MaintenanceUpdate(
          midnightTypes.asContractAddress(contractAddress),
          [insert],
          currentState.maintenanceAuthority.counter,
        );
        const signedUpdate = unsignedUpdate.addSignature(
          0n,
          ledgerApi.signData(currentSigningKey, unsignedUpdate.dataToSign),
        );
        const updateTtl = deploymentTtl();
        const unprovenUpdate = ledgerApi.Transaction.fromParts(
          networkIdApi.getNetworkId(),
          undefined,
          undefined,
          ledgerApi.Intent.new(updateTtl).addMaintenanceUpdate(signedUpdate),
        );
        const finalizedUpdate =
          await providers.walletProvider.balanceUnprovenTx(
            unprovenUpdate,
            updateTtl,
          );
        const updateId =
          await providers.midnightProvider.submitTx(finalizedUpdate);
        const updateData =
          await providers.publicDataProvider.watchForTxData(updateId);
        if (updateData.status !== midnightTypes.SucceedEntirely) {
          throw new Error(
            `Verifier key ${circuitId} failed with status ${updateData.status}.`,
          );
        }
      },
      `verifier key ${circuitId}`,
    );
    console.log(
      `[deploy] verifier key ${index + 1}/${verifierKeys.length}: ${circuitId}`,
    );
  }

  return midnightContracts.findDeployedContract(providers, {
    compiledContract,
    contractAddress,
    privateStateId,
  });
};
