from algopy import BigUInt, BoxMap, Global, UInt64, subroutine, op
from algopy.arc4 import Bool, Struct, UInt256, abimethod, emit

from ..types import ARC4UInt64, ARC4UInt256, Bytes32
from .interfaces.IRateLimiter import (
    IRateLimiter,
    BucketAdded,
    BucketRemoved,
    BucketRateLimitUpdated,
    BucketRateDurationUpdated,
    BucketConsumed,
    BucketFilled
)

# Structs
class RateLimitBucket(Struct):
    limit: ARC4UInt256
    current_capacity: ARC4UInt256
    duration: ARC4UInt64
    last_updated: ARC4UInt64


class RateLimiter(IRateLimiter):
    """Contract module that allows children to implement rate limiting mechanisms.

    The amounts used are in type uint256 (despite the extra opcode cost) to support more generic use cases.

    Buckets are referred to by their `Bytes32` identifier. These should be exposed in the external API and be unique.
    The best way to achieve this is by using readonly ABI methods with hash digests:
    ```python
    @abimethod(readonly=True)
    def inbound_bucket_id(self) -> Bytes32:
        return Bytes32.from_bytes(op.keccak256(b"INBOUND"))
    ```

    A rate limit is defined as a total amount to consume with a defined length of time. The RateLimiter can have
    multiple buckets with different parameters e.g. one bucket for inbound requests and one bucket for outbound
    requests. A duration of zero is interpreted to mean an infinite bucket.
    """
    def __init__(self) -> None:
        # bucket id -> bucket
        self.rate_limit_buckets = BoxMap(Bytes32, RateLimitBucket, key_prefix=b"rate_limit_buckets_")

    @abimethod(readonly=True)
    def get_current_capacity(self, bucket_id: Bytes32) -> UInt256:
        """Returns the current capacity of the bucket were it to be updated.

        Args:
            bucket_id: The bucket to get the current capacity for.

        Raises:
            AssertionError: If the bucket is unknown.
        """
        # fails if bucket is unknown
        self._update_capacity(bucket_id)

        # return capacity now that's updated to current time
        return self.rate_limit_buckets[bucket_id].current_capacity

    @abimethod(readonly=True)
    def has_capacity(self, bucket_id: Bytes32, amount: UInt256) -> Bool:
        """Returns whether there's sufficient capacity inside bucket for amount.

        Args:
            bucket_id: The bucket to consume from.
            amount: The amount to consume.

        Raises:
            AssertionError: If the bucket is unknown.
        """
        # fails if bucket is unknown
        self._update_capacity(bucket_id)

        # ignore if duration is zero
        rate_limit_bucket = self._get_bucket(bucket_id)
        if not rate_limit_bucket.duration.native:
            return Bool(True)

        # ensure there is enough capacity
        return Bool(amount <= rate_limit_bucket.current_capacity)

    @abimethod(readonly=True)
    def get_rate_limit(self, bucket_id: Bytes32) -> UInt256:
        """Returns the rate limit of the bucket

        Args:
            bucket_id: The bucket to get the rate limit of

        Raises:
            AssertionError: If the bucket is unknown.
        """
        self._check_bucket_known(bucket_id)
        return self.rate_limit_buckets[bucket_id].limit

    @abimethod(readonly=True)
    def get_rate_duration(self, bucket_id: Bytes32) -> UInt64:
        """Returns the rate duration of the bucket

        Args:
            bucket_id: The bucket to get the rate duration of

        Raises:
            AssertionError: If the bucket is unknown.
        """
        self._check_bucket_known(bucket_id)
        return self.rate_limit_buckets[bucket_id].duration.native

    @subroutine
    def _add_bucket(self, bucket_id: Bytes32, limit: UInt256, duration: UInt64) -> None:
        """Creates a new bucket with the specified parameters.

        Args:
            bucket_id: The bucket identifier.
            limit: The maximum capacity during the duration time.
            duration: The equivalent time to fully replenish the bucket.

        Raises:
            AssertionError: If the bucket already exists.
        """
        assert bucket_id not in self.rate_limit_buckets, "Bucket already exists"
        self.rate_limit_buckets[bucket_id] = RateLimitBucket(
            limit=limit,
            current_capacity=limit,
            duration=ARC4UInt64(duration),
            last_updated=ARC4UInt64(Global.latest_timestamp)
        )
        emit(BucketAdded(bucket_id, limit, ARC4UInt64(duration)))

    @subroutine
    def _remove_bucket(self, bucket_id: Bytes32) -> None:
        """Removes an existing bucket.

        Args:
            bucket_id: The bucket identifier.

        Raises:
            AssertionError: If the bucket is unknown.
        """
        self._check_bucket_known(bucket_id)

        del self.rate_limit_buckets[bucket_id]
        emit(BucketRemoved(bucket_id))

    @subroutine
    def _update_rate_limit(self, bucket_id: Bytes32, new_limit: UInt256) -> None:
        """Update rate limit of existing bucket.

        Args:
            bucket_id: The bucket to update.
            new_limit: The new limit to set.

        Raises:
            AssertionError: If the bucket is unknown.
        """
        # fails if bucket is unknown
        self._update_capacity(bucket_id)

        # increase or decrease capacity by change in limit
        rate_limit_bucket = self._get_bucket(bucket_id)
        if new_limit.native < rate_limit_bucket.limit.native:
            # if reducing limit then decrease capacity by difference
            diff = rate_limit_bucket.limit.native - new_limit.native
            new_capacity = rate_limit_bucket.current_capacity.native - diff \
                if rate_limit_bucket.current_capacity.native > diff else BigUInt(0)
        else:
            # if increasing limit then increase capacity by difference
            diff = new_limit.native - rate_limit_bucket.limit.native
            new_capacity = rate_limit_bucket.current_capacity.native + diff
        self.rate_limit_buckets[bucket_id].current_capacity = ARC4UInt256(new_capacity)

        # update limit
        self.rate_limit_buckets[bucket_id].limit = new_limit
        emit(BucketRateLimitUpdated(bucket_id, new_limit))

    @subroutine
    def _update_rate_duration(self, bucket_id: Bytes32, new_duration: UInt64) -> None:
        """Update duration of existing bucket.

        Args:
            bucket_id: The bucket to update.
            new_duration: The new duration to set.

        Raises:
            AssertionError: If the bucket is unknown.
        """
        # fails if bucket is unknown
        self._update_capacity(bucket_id)

        # update duration
        self.rate_limit_buckets[bucket_id].duration = ARC4UInt64(new_duration)
        emit(BucketRateDurationUpdated(bucket_id, ARC4UInt64(new_duration)))

    @subroutine(inline=False)
    def _consume_amount(self, bucket_id: Bytes32, amount: UInt256) -> None:
        """Consumes an amount inside a bucket.

        Args:
            bucket_id: The bucket to consume from.
            amount: The amount to consume.

        Raises:
            AssertionError: If the bucket is unknown.
            AssertionError: If there is insufficient capacity.
        """
        # fails if bucket is unknown
        self._update_capacity(bucket_id)

        # ignore if duration is zero
        rate_limit_bucket = self._get_bucket(bucket_id)
        if not rate_limit_bucket.duration.native:
            return

        # ensure there is enough capacity
        assert amount <= rate_limit_bucket.current_capacity, "Insufficient capacity to consume"

        # consume amount
        new_capacity = rate_limit_bucket.current_capacity.native - amount.native
        self.rate_limit_buckets[bucket_id].current_capacity = ARC4UInt256(new_capacity)
        emit(BucketConsumed(bucket_id, amount))

    @subroutine(inline=False)
    def _fill_amount(self, bucket_id: Bytes32, amount: UInt256) -> None:
        """Fills an amount inside a bucket. Will not exceed the bucket's limit.

        Args:
            bucket_id: The bucket to fill into.
            amount: The amount to fill.

        Raises:
            AssertionError: If the bucket is unknown.
        """
        # fails if bucket is unknown
        self._update_capacity(bucket_id)

        # ignore if duration is zero
        rate_limit_bucket = self._get_bucket(bucket_id)
        if not rate_limit_bucket.duration.native:
            return

        # fill amount without exceeding limit
        max_fill_amount = rate_limit_bucket.limit.native - rate_limit_bucket.current_capacity.native
        fill_amount = amount.native if amount.native < max_fill_amount else max_fill_amount
        new_capacity = rate_limit_bucket.current_capacity.native + fill_amount
        self.rate_limit_buckets[bucket_id].current_capacity = ARC4UInt256(new_capacity)
        emit(BucketFilled(bucket_id, ARC4UInt256(fill_amount)))

    @subroutine(inline=False)
    def _update_capacity(self, bucket_id: Bytes32) -> None:
        # fails if bucket is unknown
        rate_limit_bucket = self._get_bucket(bucket_id)

        # ignore if duration is zero
        if not rate_limit_bucket.duration.native:
            return

        # increase capacity by fill rate of <limit> per <duration> without exceeding limit
        time_delta = Global.latest_timestamp - rate_limit_bucket.last_updated.native
        new_capacity_without_max = rate_limit_bucket.current_capacity.native + (
                (rate_limit_bucket.limit.native * time_delta) // rate_limit_bucket.duration.native
        )

        # update capacity and last updated timestamp
        self.rate_limit_buckets[bucket_id].current_capacity = rate_limit_bucket.limit \
            if new_capacity_without_max > rate_limit_bucket.limit else ARC4UInt256(new_capacity_without_max)
        self.rate_limit_buckets[bucket_id].last_updated = ARC4UInt64(Global.latest_timestamp)

    @subroutine
    def _check_bucket_known(self, bucket_id: Bytes32) -> None:
        assert bucket_id in self.rate_limit_buckets, "Unknown bucket"

    @subroutine
    def _get_bucket(self, bucket_id: Bytes32) -> RateLimitBucket:
        self._check_bucket_known(bucket_id)
        return self.rate_limit_buckets[bucket_id]
