import { randomBytes } from 'node:crypto';

import {
  errorText,
  queryContractLedger,
  runNetworkExample,
  waitForContractLedger,
  withTimeout,
} from './network-example-runner.mjs';

const privateStateId = 'ownableCounterPrivateState';
const zeroBytes = new Uint8Array(32);

export { errorText };

export const runOwnableCounter = async ({
  compatibilityLine,
  toolchainDirectory,
  supportedProfiles,
  compactJs,
  compactRuntime,
  ledger,
  deployContract,
  Contract,
  readLedger,
  configureProviders,
  walletApi,
}) =>
  runNetworkExample({
    compatibilityLine,
    toolchainDirectory,
    supportedProfiles,
    artifactId: 'ownable-counter',
    requiredProver: 'increment.prover',
    ledger,
    configureProviders,
    walletApi,
    execute: async ({
      profile,
      providers,
      zkConfigPath,
      operationTimeoutMs,
      stateTimeoutMs,
    }) => {
      const secretKeyType = new compactRuntime.CompactTypeVector(
        1,
        new compactRuntime.CompactTypeBytes(32),
      );
      const ownerFor = (secretKey) => ({
        is_left: true,
        left: compactRuntime.persistentHash(secretKeyType, [secretKey]),
        right: { bytes: zeroBytes },
      });
      const witnesses = {
        wit_OwnableSK(context) {
          return [
            context.privateState,
            Uint8Array.from(context.privateState.ownerSecret),
          ];
        },
      };
      const waitForCounter = (contractAddress, expected) =>
        waitForContractLedger({
          providers,
          contractAddress,
          readLedger,
          predicate: (state) => state.counter === expected,
          timeoutMs: stateTimeoutMs,
          description: `counter=${expected}`,
        });
      const expectOwnerRejection = async (
        deployed,
        contractAddress,
        unchangedCounter,
      ) => {
        let rejection;
        try {
          await withTimeout(
            deployed.callTx.increment(),
            operationTimeoutMs,
            'unauthorized increment',
          );
        } catch (error) {
          rejection = error;
        }
        if (!rejection) {
          throw new Error('Unauthorized increment unexpectedly succeeded.');
        }
        if (!/Ownable: caller is not the owner/.test(errorText(rejection))) {
          throw new Error(
            'Unauthorized increment failed for an unexpected reason.',
            { cause: rejection },
          );
        }
        const actual = await queryContractLedger(
          providers,
          contractAddress,
          readLedger,
        );
        if (actual?.counter !== unchangedCounter) {
          throw new Error(
            `Unauthorized increment changed counter from ${unchangedCounter} to ${actual?.counter}.`,
          );
        }
      };

      const compiledContract = compactJs.CompiledContract.make(
        'ownable-counter',
        Contract,
      ).pipe(
        compactJs.CompiledContract.withWitnesses(witnesses),
        compactJs.CompiledContract.withCompiledFileAssets(zkConfigPath),
      );
      const ownerSecret = randomBytes(32);
      const strangerSecret = randomBytes(32);
      const newOwnerSecret = randomBytes(32);

      console.log('[e2e] deploying Ownable Counter');
      const deployed = await withTimeout(
        deployContract(providers, {
          compiledContract,
          privateStateId,
          initialPrivateState: { ownerSecret },
          args: [ownerFor(ownerSecret)],
        }),
        operationTimeoutMs,
        'contract deployment',
      );
      const contractAddress = deployed.deployTxData.public.contractAddress;
      console.log(`[e2e] deployed contract=${contractAddress}`);
      await waitForCounter(contractAddress, 0n);

      console.log('[e2e] owner increment: expect 0 -> 1');
      await withTimeout(
        deployed.callTx.increment(),
        operationTimeoutMs,
        'owner increment',
      );
      await waitForCounter(contractAddress, 1n);

      console.log('[e2e] stranger increment: expect authorization rejection');
      providers.privateStateProvider.setContractAddress(contractAddress);
      await providers.privateStateProvider.set(privateStateId, {
        ownerSecret: strangerSecret,
      });
      await expectOwnerRejection(deployed, contractAddress, 1n);

      console.log('[e2e] transferring ownership');
      await providers.privateStateProvider.set(privateStateId, { ownerSecret });
      await withTimeout(
        deployed.callTx.transferOwnership(ownerFor(newOwnerSecret)),
        operationTimeoutMs,
        'ownership transfer',
      );

      console.log('[e2e] old owner increment: expect authorization rejection');
      await expectOwnerRejection(deployed, contractAddress, 1n);

      console.log('[e2e] new owner increment: expect 1 -> 2');
      await providers.privateStateProvider.set(privateStateId, {
        ownerSecret: newOwnerSecret,
      });
      await withTimeout(
        deployed.callTx.increment(),
        operationTimeoutMs,
        'new owner increment',
      );
      await waitForCounter(contractAddress, 2n);

      console.log(
        `[e2e] PASS ${profile.id}: deploy, owner authorization, rejection, transfer, final counter=2`,
      );
    },
  });
