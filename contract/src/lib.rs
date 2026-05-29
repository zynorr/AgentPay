//! PaymentRegistry — an on-chain payment ledger for the AgentPay gateway.
//!
//! Every verified x402/MPP payment received by the gateway is recorded here
//! by the gateway operator (the contract `admin`), giving the project a
//! verifiable, tamper-evident history of every paid API call on Stellar
//! testnet.
//!
//! # Storage
//! - `Admin`        — the account allowed to call `record_payment`
//! - `Payments`     — a `Vec<Payment>` of all recorded payments
//! - `Count`        — total number of recorded payments (u32)
//! - `TotalVolume`  — cumulative amount received, in base units (i128)

#![no_std]

use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String, Vec};

/// A fresh, empty payment list (typed so the host can infer the element type).
fn empty_payments(env: &Env) -> Vec<Payment> {
    Vec::new(env)
}

/// Approximate ledgers per day (5s per ledger on Stellar).
const DAY_LEDGERS: u32 = 17280;
/// Re-extend TTL when remaining time drops below this threshold.
const TTL_THRESHOLD: u32 = 30 * DAY_LEDGERS;
/// Extend instance storage TTL out to this many ledgers (~120 days).
const TTL_EXTEND_TO: u32 = 120 * DAY_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Payments,
    Count,
    TotalVolume,
}

/// A single recorded payment.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Payment {
    pub payer: Address,
    pub amount: i128,
    pub request_id: String,
    pub timestamp: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    InvalidAmount = 2,
    IndexOutOfBounds = 3,
}

/// Emitted whenever a payment is recorded. `request_id` and `payer` are the
/// event topics; `amount` and `count` travel in the event data payload.
#[contractevent]
pub struct PaymentRecorded {
    #[topic]
    pub request_id: String,
    #[topic]
    pub payer: Address,
    pub amount: i128,
    pub count: u32,
}

#[contract]
pub struct PaymentRegistry;

#[contractimpl]
impl PaymentRegistry {
    /// Initializes the registry with the gateway operator's address.
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Count, &0u32);
        env.storage().instance().set(&DataKey::TotalVolume, &0i128);
        env.storage().instance().set(&DataKey::Payments, &empty_payments(&env));
        extend_ttl(&env);
    }

    /// Records a payment. Only the `admin` (the gateway operator) may call
    /// this. Returns the new total payment count.
    pub fn record_payment(
        env: Env,
        payer: Address,
        amount: i128,
        request_id: String,
    ) -> Result<u32, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut payments: Vec<Payment> = env
            .storage()
            .instance()
            .get(&DataKey::Payments)
            .unwrap_or_else(|| empty_payments(&env));
        let count: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        let mut total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalVolume)
            .unwrap_or(0);

        let timestamp = env.ledger().timestamp();

        payments.push_back(Payment {
            payer: payer.clone(),
            amount,
            request_id: request_id.clone(),
            timestamp,
        });
        total += amount;
        let count = count + 1;

        env.storage().instance().set(&DataKey::Payments, &payments);
        env.storage().instance().set(&DataKey::Count, &count);
        env.storage().instance().set(&DataKey::TotalVolume, &total);
        extend_ttl(&env);

        PaymentRecorded {
            request_id,
            payer,
            amount,
            count,
        }
        .publish(&env);

        Ok(count)
    }

    /// Total number of recorded payments.
    pub fn payment_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    /// Cumulative volume in base units (1 XLM = 10_000_000 base units).
    pub fn total_volume(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalVolume)
            .unwrap_or(0)
    }

    /// Full payment history, oldest first.
    pub fn payments(env: Env) -> Vec<Payment> {
        env.storage()
            .instance()
            .get(&DataKey::Payments)
            .unwrap_or_else(|| empty_payments(&env))
    }

    /// A single payment by index.
    pub fn payment(env: Env, index: u32) -> Result<Payment, Error> {
        let payments: Vec<Payment> = env
            .storage()
            .instance()
            .get(&DataKey::Payments)
            .unwrap_or_else(|| empty_payments(&env));
        payments.get(index).ok_or(Error::IndexOutOfBounds)
    }
}

fn extend_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, String};

    #[test]
    fn test_record_and_query() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(PaymentRegistry, (admin.clone(),));
        let client = PaymentRegistryClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let req_id = String::from_str(&env, "req-abc-123");

        let count = client.record_payment(&payer, &1000i128, &req_id);
        assert_eq!(count, 1);
        assert_eq!(client.payment_count(), 1);
        assert_eq!(client.total_volume(), 1000i128);

        // The generated client unwraps the contract's `Result` for the plain
        // method; the `try_*` variant exposes it.
        let p = client.payment(&0);
        assert_eq!(p.payer, payer);
        assert_eq!(p.amount, 1000i128);
        assert_eq!(p.request_id, req_id);

        // Second payment accumulates
        let count = client.record_payment(&payer, &250i128, &String::from_str(&env, "req-2"));
        assert_eq!(count, 2);
        assert_eq!(client.total_volume(), 1250i128);
    }

    #[test]
    fn test_rejects_zero_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(PaymentRegistry, (admin.clone(),));
        let client = PaymentRegistryClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let res = client.try_record_payment(&payer, &0i128, &String::from_str(&env, "req-0"));
        assert!(res.is_err(), "zero amounts must be rejected");
        assert_eq!(client.payment_count(), 0);
    }
}
