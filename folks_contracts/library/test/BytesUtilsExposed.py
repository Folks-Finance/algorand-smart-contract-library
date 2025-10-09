from algopy import UInt64
from algopy.arc4 import ARC4Contract, abimethod

from ...types import Bytes32
from .. import BytesUtils


class BytesUtilsExposed(ARC4Contract):
    @abimethod(readonly=True)
    def convert_uint64_to_bytes32(self, a: UInt64) -> Bytes32:
        return BytesUtils.convert_uint64_to_bytes32(a)

    @abimethod(readonly=True)
    def safe_convert_bytes32_to_uint64(self, a: Bytes32) -> UInt64:
        return BytesUtils.safe_convert_bytes32_to_uint64(a)
