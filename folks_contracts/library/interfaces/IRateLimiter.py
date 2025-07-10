from abc import ABC, abstractmethod
from algopy import ARC4Contract
from algopy.arc4 import Bool, Struct, UInt256, abimethod

from ...types import ARC4UInt64, ARC4UInt256, Bytes32


# Events
class BucketAdded(Struct):
    bucket_id: Bytes32
    limit: ARC4UInt256
    duration: ARC4UInt64

class BucketRemoved(Struct):
    bucket_id: Bytes32

class BucketRateLimitUpdated(Struct):
    bucket_id: Bytes32
    limit: ARC4UInt256

class BucketRateDurationUpdated(Struct):
    bucket_id: Bytes32
    duration: ARC4UInt64

class BucketConsumed(Struct):
    bucket_id: Bytes32
    amount: ARC4UInt256

class BucketFilled(Struct):
    bucket_id: Bytes32
    amount: ARC4UInt256



class IRateLimiter(ARC4Contract, ABC):
    @abstractmethod
    @abimethod(readonly=True)
    def get_current_capacity(self, bucket_id: Bytes32) -> UInt256:
        pass

    @abstractmethod
    @abimethod(readonly=True)
    def has_capacity(self, bucket_id: Bytes32, amount: UInt256) -> Bool:
        pass
