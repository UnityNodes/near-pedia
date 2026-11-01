//! One hash of NEAR-pedia's database per day, written by its owner and
//! never changed afterwards: an answer that names the day's hash can be
//! checked against what was recorded on chain that day, and a later rewrite
//! of the database cannot rewrite the record.
//!
//! The contract alone cannot stop whoever holds a full-access key to its
//! account from deploying other code. It is meant to live on an account of
//! its own whose full-access keys are deleted after `new`, recorded into by a
//! separate owner account through a function-call key limited to `record`.

use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Record {
    pub date: String,
    pub hash: String,
    pub tables: u32,
    pub rows: u64,
    pub block_height: u64,
    pub timestamp_ms: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Anchor {
    owner: AccountId,
    by_date: LookupMap<String, Record>,
    dates: Vector<String>,
}

/// Days since 1970-01-01 of a valid `YYYY-MM-DD`, or None. A date that only
/// looks like one ("9999-99-99") would make "dates must increase" refuse
/// every real date after it, for good.
fn day_number(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    if !b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) {
        return None;
    }
    let y: i64 = s[0..4].parse().ok()?;
    let m: i64 = s[5..7].parse().ok()?;
    let d: i64 = s[8..10].parse().ok()?;
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days_in = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if !(1..=12).contains(&m) || d < 1 || d > days_in[(m - 1) as usize] {
        return None;
    }
    let (yy, mm) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let doy = (153 * mm + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

#[near]
impl Anchor {
    #[init]
    #[private]
    pub fn new(owner: AccountId) -> Self {
        Self { owner, by_date: LookupMap::new(b"r"), dates: Vector::new(b"d") }
    }

    pub fn record(&mut self, date: String, hash: String, tables: u32, rows: u64) -> Record {
        require!(env::predecessor_account_id() == self.owner, "only the owner records");
        let day = day_number(&date);
        require!(day.is_some(), "date must be a real YYYY-MM-DD");
        let today = (env::block_timestamp_ms() / 86_400_000) as i64;
        require!(day.unwrap() <= today + 1, "date is more than a day ahead of the chain");
        require!(is_sha256_hex(&hash), "hash must be 64 lowercase hex characters");
        require!(!self.by_date.contains_key(&date), "this date is already recorded and cannot change");
        if let Some(last) = self.dates.get(self.dates.len().wrapping_sub(1)) {
            require!(date > *last, "dates must increase");
        }
        let r = Record {
            date: date.clone(),
            hash,
            tables,
            rows,
            block_height: env::block_height(),
            timestamp_ms: env::block_timestamp_ms(),
        };
        self.by_date.insert(date.clone(), r.clone());
        self.dates.push(date);
        r
    }

    pub fn get(&self, date: String) -> Option<Record> {
        self.by_date.get(&date).cloned()
    }

    pub fn latest(&self) -> Option<Record> {
        let n = self.dates.len();
        if n == 0 {
            return None;
        }
        self.dates.get(n - 1).and_then(|d| self.by_date.get(d).cloned())
    }

    pub fn count(&self) -> u32 {
        self.dates.len()
    }

    pub fn owner(&self) -> AccountId {
        self.owner.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const H: &str = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

    // 2026-11-01T12:00:00Z
    const NOW_MS: u64 = 1_793_534_400_000;

    fn as_account(who: &str) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("anchor.nearpedia.near".parse().unwrap())
            .predecessor_account_id(who.parse().unwrap())
            .block_timestamp(NOW_MS * 1_000_000)
            .build());
    }

    #[test]
    fn day_number_matches_the_calendar() {
        assert_eq!(day_number("1970-01-01"), Some(0));
        assert_eq!(day_number("2026-11-01"), Some((NOW_MS / 86_400_000) as i64));
        assert_eq!(day_number("2024-02-29").is_some(), true);
        assert_eq!(day_number("2026-02-29"), None);
        assert_eq!(day_number("9999-99-99"), None);
        assert_eq!(day_number("2026-13-01"), None);
    }

    #[test]
    #[should_panic(expected = "more than a day ahead")]
    fn refuses_a_date_from_a_wrong_clock() {
        as_account("anchor.nearpedia.near");
        let mut c = Anchor::new("nearpedia.near".parse().unwrap());
        as_account("nearpedia.near");
        c.record("2026-11-05".into(), H.into(), 40, 1000);
    }

    #[test]
    fn records_once_per_date_and_reads_back() {
        as_account("anchor.nearpedia.near");
        let mut c = Anchor::new("nearpedia.near".parse().unwrap());
        as_account("nearpedia.near");
        c.record("2026-11-01".into(), H.into(), 40, 1000);
        assert_eq!(c.get("2026-11-01".into()).unwrap().hash, H);
        assert_eq!(c.latest().unwrap().date, "2026-11-01");
        assert_eq!(c.count(), 1);
    }

    #[test]
    #[should_panic(expected = "already recorded")]
    fn a_recorded_date_cannot_change() {
        as_account("anchor.nearpedia.near");
        let mut c = Anchor::new("nearpedia.near".parse().unwrap());
        as_account("nearpedia.near");
        c.record("2026-11-01".into(), H.into(), 40, 1000);
        c.record("2026-11-01".into(), H.replace('0', "1"), 40, 1000);
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn only_the_owner_records() {
        as_account("anchor.nearpedia.near");
        let mut c = Anchor::new("nearpedia.near".parse().unwrap());
        as_account("nearpedia.near");
        as_account("mallory.near");
        c.record("2026-11-01".into(), H.into(), 40, 1000);
    }

    #[test]
    #[should_panic(expected = "dates must increase")]
    fn dates_only_move_forward() {
        as_account("anchor.nearpedia.near");
        let mut c = Anchor::new("nearpedia.near".parse().unwrap());
        as_account("nearpedia.near");
        c.record("2026-11-02".into(), H.into(), 40, 1000);
        c.record("2026-11-01".into(), H.into(), 40, 1000);
    }

    #[test]
    #[should_panic(expected = "64 lowercase hex")]
    fn rejects_a_malformed_hash() {
        as_account("anchor.nearpedia.near");
        let mut c = Anchor::new("nearpedia.near".parse().unwrap());
        as_account("nearpedia.near");
        c.record("2026-11-01".into(), "abc".into(), 40, 1000);
    }
}
