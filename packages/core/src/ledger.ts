import { FormKitNode } from './node'
import { FormKitEvent } from './events'
import { FormKitMessage } from './store'
import { has } from '@formkit/utils'

/**
 * The FormKit ledger, a general-purpose message counting service provided by
 * FormKit core for counting messages throughout a tree.
 * @public
 */
export interface FormKitLedger {
  init: (node: FormKitNode<any>) => void
  count: (
    name: string,
    condition?: FormKitCounterCondition,
    initialValue?: number
  ) => Promise<void>
  settled: (name: string) => Promise<void>
  value: (name: string) => number
}

/**
 * Ledger counters require a condition function that determines if a given
 * message applies to it or not.
 * @public
 */
export interface FormKitCounterCondition {
  (message: FormKitMessage): boolean
}

/**
 * The counter object used to perform instance counting within
 * a tree.
 * @public
 */
export interface FormKitCounter {
  name: string
  count: number
  promise: Promise<void>
  resolve: () => void
  condition: FormKitCounterCondition
}

/**
 * The internal ledger store structure.
 * @internal
 */
interface FormKitLedgerStore {
  [index: string]: FormKitCounter
}

/**
 * Creates a new ledger for use on a single node's context.
 * @returns
 */
export function createLedger(): FormKitLedger {
  const ledger: FormKitLedgerStore = {}
  return {
    count: (...args) => createCounter(ledger, ...args),
    init(node: FormKitNode<any>) {
      node.on('message-added.deep', add(ledger, 1))
      node.on('message-removed.deep', add(ledger, -1))
    },
    settled(counterName: string): Promise<void> {
      return has(ledger, counterName)
        ? ledger[counterName].promise
        : Promise.resolve()
    },
    value(counterName: string) {
      return has(ledger, counterName) ? ledger[counterName].count : 0
    },
  }
}

/**
 * Creates a new counter object in the counting ledger.
 * @param ledger - The actual ledger storage object
 * @param counterName - The name of the counter, can be arbitrary
 * @param condition - The condition function (or string) that filters messages
 * @param initialValue - The initial counter value
 * @returns
 */
function createCounter(
  ledger: FormKitLedgerStore,
  counterName: string,
  condition?: FormKitCounterCondition | string,
  initialValue = 0
): Promise<void> {
  condition = parseCondition(condition || counterName)
  if (!has(ledger, counterName)) {
    const counter: FormKitCounter = {
      count: initialValue,
      name: counterName,
      condition,
      promise: !initialValue
        ? Promise.resolve()
        : new Promise<void>((r) => (counter.resolve = r)),
      resolve: () => {}, // eslint-disable-line
    }
    ledger[counterName] = counter
    return counter.promise
  }
  ledger[counterName].condition = condition
  return count(ledger[counterName], initialValue).promise
}

/**
 * We parse the condition to allow flexibility in how counters are specified.
 * @param condition - The condition that, if true, allows a message to change a counter's value
 * @returns
 */
function parseCondition(
  condition: string | FormKitCounterCondition
): FormKitCounterCondition {
  if (typeof condition === 'function') {
    return condition
  }
  return (m: FormKitMessage) => m.type === condition
}

/**
 * Perform a counting action on the a given counter object of the ledger.
 * @param counter - A counter object
 * @param increment - The amount by which we are changing the count value
 * @returns
 */
function count(counter: FormKitCounter, increment: number): FormKitCounter {
  const initial = counter.count
  const post = counter.count + increment
  counter.count = post
  if (initial === 0 && post !== 0) {
    counter.promise = new Promise((r) => (counter.resolve = r))
  } else if (initial !== 0 && post === 0) {
    counter.resolve()
  }
  return counter
}

/**
 * Returns a function to be used as an event listener for message events.
 * @param ledger - A ledger to operate on
 * @param delta - The amount to add or subtract
 * @returns
 */
function add(ledger: FormKitLedgerStore, delta: number) {
  return (e: FormKitEvent) => {
    for (const name in ledger) {
      const counter = ledger[name]
      if (counter.condition(e.payload)) {
        count(counter, delta)
      }
    }
  }
}
