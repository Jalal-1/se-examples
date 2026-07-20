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
} from '../artifacts/ownable-counter/contract/index.js';

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
const accountOwner = (secretKey) => ({
  is_left: true,
  left: accountIdFor(secretKey),
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

class OwnableCounterSimulator {
  static async create(ownerSecret) {
    const simulator = new OwnableCounterSimulator();
    simulator.contract = new Contract(witnesses);
    const initial = await simulator.contract.initialState(
      createConstructorContext(
        { ownerSecret: Uint8Array.from(ownerSecret) },
        '0'.repeat(64),
      ),
      accountOwner(ownerSecret),
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

  useSecret(ownerSecret) {
    this.context = {
      ...this.context,
      callContext: {
        ...this.context.callContext,
        currentPrivateState: { ownerSecret: Uint8Array.from(ownerSecret) },
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
}

const ownerSecret = secretFor('OWNER');
const newOwnerSecret = secretFor('NEW_OWNER');
const strangerSecret = secretFor('STRANGER');

describe('OpenZeppelin Ownable Counter on v2', () => {
  test('initializes the owner and counter', async () => {
    const simulator = await OwnableCounterSimulator.create(ownerSecret);
    assert.equal(simulator.publicState.counter, 0n);
    assert.deepEqual(await simulator.call('owner'), accountOwner(ownerSecret));
  });

  test('allows the owner to increment', async () => {
    const simulator = await OwnableCounterSimulator.create(ownerSecret);
    await simulator.call('increment');
    assert.equal(simulator.publicState.counter, 1n);
  });

  test('rejects a non-owner without changing state', async () => {
    const simulator = await OwnableCounterSimulator.create(ownerSecret);
    simulator.useSecret(strangerSecret);
    await assert.rejects(
      simulator.call('increment'),
      /Ownable: caller is not the owner/,
    );
    assert.equal(simulator.publicState.counter, 0n);
  });

  test('moves increment authority to the new owner', async () => {
    const simulator = await OwnableCounterSimulator.create(ownerSecret);
    await simulator.call('transferOwnership', accountOwner(newOwnerSecret));
    assert.deepEqual(
      await simulator.call('owner'),
      accountOwner(newOwnerSecret),
    );
    await assert.rejects(
      simulator.call('increment'),
      /Ownable: caller is not the owner/,
    );
    simulator.useSecret(newOwnerSecret);
    await simulator.call('increment');
    assert.equal(simulator.publicState.counter, 1n);
  });
});
