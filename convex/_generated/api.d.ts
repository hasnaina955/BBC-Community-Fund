/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aggregate from "../aggregate.js";
import type * as auth from "../auth.js";
import type * as balances from "../balances.js";
import type * as collections from "../collections.js";
import type * as data from "../data.js";
import type * as funds from "../funds.js";
import type * as gateway from "../gateway.js";
import type * as http from "../http.js";
import type * as lib_arrears from "../lib/arrears.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_balances from "../lib/balances.js";
import type * as lib_collection from "../lib/collection.js";
import type * as lib_funds from "../lib/funds.js";
import type * as lib_ledger from "../lib/ledger.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_password from "../lib/password.js";
import type * as lib_payments from "../lib/payments.js";
import type * as lib_reminders from "../lib/reminders.js";
import type * as lib_sequence from "../lib/sequence.js";
import type * as members from "../members.js";
import type * as portal from "../portal.js";
import type * as receipts from "../receipts.js";
import type * as reconciliation from "../reconciliation.js";
import type * as reminders from "../reminders.js";
import type * as seed from "../seed.js";
import type * as transactions from "../transactions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aggregate: typeof aggregate;
  auth: typeof auth;
  balances: typeof balances;
  collections: typeof collections;
  data: typeof data;
  funds: typeof funds;
  gateway: typeof gateway;
  http: typeof http;
  "lib/arrears": typeof lib_arrears;
  "lib/audit": typeof lib_audit;
  "lib/authz": typeof lib_authz;
  "lib/balances": typeof lib_balances;
  "lib/collection": typeof lib_collection;
  "lib/funds": typeof lib_funds;
  "lib/ledger": typeof lib_ledger;
  "lib/money": typeof lib_money;
  "lib/notify": typeof lib_notify;
  "lib/password": typeof lib_password;
  "lib/payments": typeof lib_payments;
  "lib/reminders": typeof lib_reminders;
  "lib/sequence": typeof lib_sequence;
  members: typeof members;
  portal: typeof portal;
  receipts: typeof receipts;
  reconciliation: typeof reconciliation;
  reminders: typeof reminders;
  seed: typeof seed;
  transactions: typeof transactions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
