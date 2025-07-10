from algopy import Global, UInt64
from algopy.arc4 import Bool, UInt256, abimethod

from ...types import ARC4UInt64, Bytes32
from ..RateLimiter import RateLimiter, RateLimitBucket


class RateLimiterExposed(RateLimiter):
    @abimethod
    def set_current_capacity(self, bucket_id: Bytes32, capacity: UInt256) -> None:
        """Strictly for testing purposes. No check to ensure capacity doesn't exceed limit."""
        self._check_bucket_known(bucket_id)

        self.rate_limit_buckets[bucket_id].current_capacity = capacity
        self.rate_limit_buckets[bucket_id].last_updated = ARC4UInt64(Global.latest_timestamp)

    @abimethod
    def add_bucket(self, bucket_id: Bytes32, limit: UInt256, duration: UInt64) -> None:
        self._add_bucket(bucket_id, limit, duration)

    @abimethod
    def remove_bucket(self, bucket_id: Bytes32) -> None:
        self._remove_bucket(bucket_id)

    @abimethod
    def update_rate_limit(self, bucket_id: Bytes32, new_limit: UInt256) -> None:
        self._update_rate_limit(bucket_id, new_limit)

    @abimethod
    def update_rate_duration(self, bucket_id: Bytes32, new_duration: UInt64) -> None:
        self._update_rate_duration(bucket_id, new_duration)

    @abimethod
    def consume_amount(self, bucket_id: Bytes32, amount: UInt256) -> None:
        self._consume_amount(bucket_id, amount)

    @abimethod
    def fill_amount(self, bucket_id: Bytes32, amount: UInt256) -> None:
        self._fill_amount(bucket_id, amount)

    @abimethod
    def update_capacity(self, bucket_id: Bytes32) -> None:
        self._update_capacity(bucket_id)

    @abimethod
    def check_bucket_known(self, bucket_id: Bytes32) -> None:
        self._check_bucket_known(bucket_id)

    @abimethod(readonly=True)
    def get_bucket(self, bucket_id: Bytes32) -> RateLimitBucket:
        return self._get_bucket(bucket_id)
