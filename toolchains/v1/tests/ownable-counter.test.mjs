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

const ZERO_BYTES = new Uint8Array(32);

const secretFor = (label) => {
  const secret = new Uint8Array(32);
  secret.set(new TextEncoder().encode(label).slice(0, 32));
  return secret;
};

const accountIdFor = (secretKey) => {
  const secretKeyType = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(secretKeyType, [secretKey]);
};

const accountOwner = (secretKey) => ({
  is_left: true,
  left: accountIdFor(secretKey),
  right: { bytes: ZERO_BYTES },
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
  constructor(ownerSecret) {
    this.contract = new Contract(witnesses);
    const initial = this.contract.initialState(
      createConstructorContext(
        { ownerSecret: Uint8Array.from(ownerSecret) },
        '0'.repeat(64),
      ),
      accountOwner(ownerSecret),
    );

    this.context = createCircuitContext(
      sampleContractAddress(),
      initial.currentZswapLocalState,
      initial.currentContractState,
      initial.currentPrivateState,
    );
  }

  get publicState() {
    return ledger(this.context.currentQueryContext.state);
  }

  useSecret(ownerSecret) {
    this.context = {
      ...this.context,
      currentPrivateState: { ownerSecret: Uint8Array.from(ownerSecret) },
    };
  }

  call(circuit, ...args) {
    const result = this.contract.impureCircuits[circuit](this.context, ...args);
    this.context = result.context;
    return result.result;
  }
}

const OWNER_SECRET = secretFor('OWNER');
const NEW_OWNER_SECRET = secretFor('NEW_OWNER');
const STRANGER_SECRET = secretFor('STRANGER');

describe('OpenZeppelin Ownable Counter', () => {
  test('initializes the owner and counter', () => {
    const simulator = new OwnableCounterSimulator(OWNER_SECRET);

    assert.equal(simulator.publicState.counter, 0n);
    assert.deepEqual(simulator.call('owner'), accountOwner(OWNER_SECRET));
  });

  test('allows the owner to increment', () => {
    const simulator = new OwnableCounterSimulator(OWNER_SECRET);

    simulator.call('increment');

    assert.equal(simulator.publicState.counter, 1n);
  });

  test('rejects a non-owner without changing state', () => {
    const simulator = new OwnableCounterSimulator(OWNER_SECRET);
    simulator.useSecret(STRANGER_SECRET);

    assert.throws(
      () => simulator.call('increment'),
      /Ownable: caller is not the owner/,
    );
    assert.equal(simulator.publicState.counter, 0n);
  });

  test('moves increment authority to the new owner', () => {
    const simulator = new OwnableCounterSimulator(OWNER_SECRET);

    simulator.call('transferOwnership', accountOwner(NEW_OWNER_SECRET));
    assert.deepEqual(simulator.call('owner'), accountOwner(NEW_OWNER_SECRET));

    assert.throws(
      () => simulator.call('increment'),
      /Ownable: caller is not the owner/,
    );

    simulator.useSecret(NEW_OWNER_SECRET);
    simulator.call('increment');
    assert.equal(simulator.publicState.counter, 1n);
  });
});
