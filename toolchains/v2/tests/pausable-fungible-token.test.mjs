import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CompactTypeBytes,
  CompactTypeVector,
  createCircuitContext,
  createConstructorContext,
  persistentHash,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract,
  ledger,
} from '../artifacts/pausable-fungible-token/contract/index.js';

const zeroBytes = new Uint8Array(32);
const secretFor = (label) => {
  const secret = new Uint8Array(32);
  secret.set(new TextEncoder().encode(label).slice(0, 32));
  return secret;
};
const accountIdFor = (secretKey) =>
  persistentHash(
    new CompactTypeVector(1, new CompactTypeBytes(32)),
    [secretKey],
  );
const accountFor = (secretKey) => ({
  is_left: true,
  left: accountIdFor(secretKey),
  right: { bytes: zeroBytes },
});
const witnesses = {
  wit_OwnableSK(context) {
    return [context.privateState, Uint8Array.from(context.privateState.userSecret)];
  },
  wit_FungibleTokenSK(context) {
    return [context.privateState, Uint8Array.from(context.privateState.userSecret)];
  },
};

class TokenSimulator {
  static async create(ownerSecret) {
    const simulator = new TokenSimulator();
    simulator.contract = new Contract(witnesses);
    const initial = await simulator.contract.initialState(
      createConstructorContext(
        { userSecret: Uint8Array.from(ownerSecret) },
        '0'.repeat(64),
      ),
      'Solutions Example Token',
      'SET',
      2n,
      1_000n,
      accountFor(ownerSecret),
    );
    simulator.context = createCircuitContext(
      'simulator',
      sampleContractAddress(),
      initial.currentZswapLocalState,
      initial.currentContractState,
      initial.currentPrivateState,
    );
    return simulator;
  }

  get publicState() {
    return ledger(this.context.callContext.currentQueryContext.state);
  }

  useSecret(userSecret) {
    this.context = {
      ...this.context,
      callContext: {
        ...this.context.callContext,
        currentPrivateState: { userSecret: Uint8Array.from(userSecret) },
      },
    };
  }

  async call(circuit, ...args) {
    const result = await this.contract.impureCircuits[circuit](
      this.context,
      ...args,
    );
    this.context = result.context;
    return result.result;
  }

  balance(account) {
    return this.publicState.FungibleToken__balances.lookup(account);
  }

  allowance(accountOwner, spender) {
    return this.publicState.FungibleToken__allowances
      .lookup(accountOwner)
      .lookup(spender);
  }
}

const ownerSecret = secretFor('OWNER');
const spenderSecret = secretFor('SPENDER');
const recipientSecret = secretFor('RECIPIENT');
const strangerSecret = secretFor('STRANGER');
const owner = accountFor(ownerSecret);
const spender = accountFor(spenderSecret);
const recipient = accountFor(recipientSecret);

describe('OpenZeppelin Pausable Fungible Token on v2', () => {
  test('initializes metadata, ownership, and supply', async () => {
    const simulator = await TokenSimulator.create(ownerSecret);

    assert.equal(await simulator.call('name'), 'Solutions Example Token');
    assert.equal(await simulator.call('symbol'), 'SET');
    assert.equal(await simulator.call('decimals'), 2n);
    assert.deepEqual(await simulator.call('owner'), owner);
    assert.equal(simulator.publicState.FungibleToken__totalSupply, 1_000n);
    assert.equal(simulator.balance(owner), 1_000n);
    assert.equal(simulator.publicState.Pausable__isPaused, false);
  });

  test('transfers balances without changing total supply', async () => {
    const simulator = await TokenSimulator.create(ownerSecret);

    assert.equal(await simulator.call('transfer', recipient, 125n), true);
    assert.equal(simulator.balance(owner), 875n);
    assert.equal(simulator.balance(recipient), 125n);
    assert.equal(simulator.publicState.FungibleToken__totalSupply, 1_000n);
  });

  test('rejects non-owner administration without changing state', async () => {
    const simulator = await TokenSimulator.create(ownerSecret);
    simulator.useSecret(strangerSecret);

    await assert.rejects(
      simulator.call('pause'),
      /Ownable: caller is not the owner/,
    );
    await assert.rejects(
      simulator.call('mint', accountFor(strangerSecret), 50n),
      /Ownable: caller is not the owner/,
    );
    assert.equal(simulator.publicState.Pausable__isPaused, false);
    assert.equal(simulator.publicState.FungibleToken__totalSupply, 1_000n);
  });

  test('blocks token mutations while paused and resumes after unpause', async () => {
    const simulator = await TokenSimulator.create(ownerSecret);

    await simulator.call('pause');
    assert.equal(simulator.publicState.Pausable__isPaused, true);
    await assert.rejects(
      simulator.call('transfer', recipient, 100n),
      /Pausable: paused/,
    );
    await assert.rejects(
      simulator.call('approve', spender, 100n),
      /Pausable: paused/,
    );
    await assert.rejects(
      simulator.call('mint', recipient, 100n),
      /Pausable: paused/,
    );
    assert.equal(simulator.balance(owner), 1_000n);
    assert.equal(simulator.publicState.FungibleToken__totalSupply, 1_000n);

    await simulator.call('unpause');
    assert.equal(await simulator.call('transfer', recipient, 100n), true);
    assert.equal(simulator.balance(owner), 900n);
    assert.equal(simulator.balance(recipient), 100n);
  });

  test('spends and reduces an allowance through transferFrom', async () => {
    const simulator = await TokenSimulator.create(ownerSecret);

    assert.equal(await simulator.call('approve', spender, 200n), true);
    assert.equal(simulator.allowance(owner, spender), 200n);
    simulator.useSecret(spenderSecret);
    assert.equal(
      await simulator.call('transferFrom', owner, recipient, 75n),
      true,
    );
    assert.equal(simulator.balance(owner), 925n);
    assert.equal(simulator.balance(recipient), 75n);
    assert.equal(simulator.allowance(owner, spender), 125n);
  });
});
