import { randomBytes } from 'node:crypto';

import {
  errorText,
  runNetworkExample,
  waitForContractLedger,
  withTimeout,
} from './network-example-runner.mjs';
import { deployContractPhased } from './phased-contract-deployment.mjs';

const privateStateId = 'pausableFungibleTokenPrivateState';
const zeroBytes = new Uint8Array(32);
const initialSupply = 1_000n;

export { errorText };

export const runPausableFungibleToken = async ({
  compatibilityLine,
  toolchainDirectory,
  supportedProfiles,
  compactJs,
  compactRuntime,
  ledger,
  midnightTypes,
  ledgerApi,
  midnightContracts,
  networkIdApi,
  operationVersion,
  Contract,
  readLedger,
  configureProviders,
  walletApi,
}) =>
  runNetworkExample({
    compatibilityLine,
    toolchainDirectory,
    supportedProfiles,
    artifactId: 'pausable-fungible-token',
    requiredProver: 'transfer.prover',
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
      const accountFor = (secretKey) => ({
        is_left: true,
        left: compactRuntime.persistentHash(secretKeyType, [secretKey]),
        right: { bytes: zeroBytes },
      });
      const witnesses = {
        wit_OwnableSK(context) {
          return [
            context.privateState,
            Uint8Array.from(context.privateState.userSecret),
          ];
        },
        wit_FungibleTokenSK(context) {
          return [
            context.privateState,
            Uint8Array.from(context.privateState.userSecret),
          ];
        },
      };
      const balanceOf = (state, account) =>
        state.FungibleToken__balances.member(account)
          ? state.FungibleToken__balances.lookup(account)
          : 0n;
      const allowance = (state, accountOwner, spender) => {
        if (!state.FungibleToken__allowances.member(accountOwner)) return 0n;
        const approvals = state.FungibleToken__allowances.lookup(accountOwner);
        return approvals.member(spender) ? approvals.lookup(spender) : 0n;
      };
      const waitForState = (contractAddress, predicate, description) =>
        waitForContractLedger({
          providers,
          contractAddress,
          readLedger,
          predicate,
          timeoutMs: stateTimeoutMs,
          description,
        });
      const expectCircuitRejection = async (promise, pattern, description) => {
        let rejection;
        try {
          await withTimeout(promise, operationTimeoutMs, description);
        } catch (error) {
          rejection = error;
        }
        if (!rejection) {
          throw new Error(`${description} unexpectedly succeeded.`);
        }
        if (!pattern.test(errorText(rejection))) {
          throw new Error(`${description} failed for an unexpected reason.`, {
            cause: rejection,
          });
        }
      };

      const compiledContract = compactJs.CompiledContract.make(
        'pausable-fungible-token',
        Contract,
      ).pipe(
        compactJs.CompiledContract.withWitnesses(witnesses),
        compactJs.CompiledContract.withCompiledFileAssets(zkConfigPath),
      );
      const ownerSecret = randomBytes(32);
      const spenderSecret = randomBytes(32);
      const recipientSecret = randomBytes(32);
      const strangerSecret = randomBytes(32);
      const owner = accountFor(ownerSecret);
      const spender = accountFor(spenderSecret);
      const recipient = accountFor(recipientSecret);

      console.log('[e2e] deploying Pausable Fungible Token');
      const deployed = await withTimeout(
        deployContractPhased({
          providers,
          compiledContract,
          privateStateId,
          initialPrivateState: { userSecret: ownerSecret },
          args: [
            'Solutions Example Token',
            'SET',
            2n,
            initialSupply,
            owner,
          ],
          compactJs,
          midnightTypes,
          ledgerApi,
          midnightContracts,
          networkIdApi,
          operationVersion,
        }),
        operationTimeoutMs,
        'contract deployment',
      );
      const contractAddress = deployed.deployTxData.public.contractAddress;
      providers.privateStateProvider.setContractAddress(contractAddress);
      console.log(`[e2e] deployed contract=${contractAddress}`);
      await waitForState(
        contractAddress,
        (state) =>
          state.FungibleToken__totalSupply === initialSupply &&
          balanceOf(state, owner) === initialSupply &&
          state.Pausable__isPaused === false,
        'initial supply=1000, owner balance=1000, paused=false',
      );

      console.log('[e2e] owner transfer: expect owner=875 recipient=125');
      await withTimeout(
        deployed.callTx.transfer(recipient, 125n),
        operationTimeoutMs,
        'owner transfer',
      );
      await waitForState(
        contractAddress,
        (state) =>
          balanceOf(state, owner) === 875n &&
          balanceOf(state, recipient) === 125n &&
          state.FungibleToken__totalSupply === initialSupply,
        'owner balance=875, recipient balance=125, supply=1000',
      );

      console.log('[e2e] stranger pause: expect authorization rejection');
      await providers.privateStateProvider.set(privateStateId, {
        userSecret: strangerSecret,
      });
      await expectCircuitRejection(
        deployed.callTx.pause(),
        /Ownable: caller is not the owner/,
        'unauthorized pause',
      );

      console.log('[e2e] owner pause and blocked transfer');
      await providers.privateStateProvider.set(privateStateId, {
        userSecret: ownerSecret,
      });
      await withTimeout(
        deployed.callTx.pause(),
        operationTimeoutMs,
        'owner pause',
      );
      await waitForState(
        contractAddress,
        (state) => state.Pausable__isPaused === true,
        'paused=true',
      );
      await expectCircuitRejection(
        deployed.callTx.transfer(recipient, 1n),
        /Pausable: paused/,
        'paused transfer',
      );

      console.log('[e2e] owner unpause and approve spender=200');
      await withTimeout(
        deployed.callTx.unpause(),
        operationTimeoutMs,
        'owner unpause',
      );
      await waitForState(
        contractAddress,
        (state) => state.Pausable__isPaused === false,
        'paused=false',
      );
      await withTimeout(
        deployed.callTx.approve(spender, 200n),
        operationTimeoutMs,
        'spender approval',
      );
      await waitForState(
        contractAddress,
        (state) => allowance(state, owner, spender) === 200n,
        'allowance=200',
      );

      console.log('[e2e] spender transferFrom: expect allowance=125');
      await providers.privateStateProvider.set(privateStateId, {
        userSecret: spenderSecret,
      });
      await withTimeout(
        deployed.callTx.transferFrom(owner, recipient, 75n),
        operationTimeoutMs,
        'delegated transfer',
      );
      await waitForState(
        contractAddress,
        (state) =>
          balanceOf(state, owner) === 800n &&
          balanceOf(state, recipient) === 200n &&
          allowance(state, owner, spender) === 125n,
        'owner balance=800, recipient balance=200, allowance=125',
      );

      console.log('[e2e] stranger mint: expect authorization rejection');
      await providers.privateStateProvider.set(privateStateId, {
        userSecret: strangerSecret,
      });
      await expectCircuitRejection(
        deployed.callTx.mint(recipient, 50n),
        /Ownable: caller is not the owner/,
        'unauthorized mint',
      );

      console.log('[e2e] owner mint: expect supply=1050 recipient=250');
      await providers.privateStateProvider.set(privateStateId, {
        userSecret: ownerSecret,
      });
      await withTimeout(
        deployed.callTx.mint(recipient, 50n),
        operationTimeoutMs,
        'owner mint',
      );
      await waitForState(
        contractAddress,
        (state) =>
          state.FungibleToken__totalSupply === 1_050n &&
          balanceOf(state, owner) === 800n &&
          balanceOf(state, recipient) === 250n &&
          allowance(state, owner, spender) === 125n,
        'supply=1050, owner balance=800, recipient balance=250, allowance=125',
      );

      console.log(
        `[e2e] PASS ${profile.id}: transfer, pause gate, allowance, transferFrom, mint, final supply=1050`,
      );
    },
  });
