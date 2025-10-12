from algopy import UInt64, op, subroutine

from .. import constants as const
from ..types import Bytes32


"""Library to convert between `uint64` and `Bytes32`."""
@subroutine
def convert_uint64_to_bytes32(a: UInt64) -> Bytes32:
    return Bytes32.from_bytes(op.replace(op.bzero(const.BYTES32_LENGTH), const.BYTES24_LENGTH, op.itob(a)))

@subroutine
def safe_convert_bytes32_to_uint64(a: Bytes32) -> UInt64:
    assert op.substring(a.bytes, 0, const.BYTES24_LENGTH) == op.bzero(const.BYTES24_LENGTH), "Unsafe conversion of bytes32 to uint64"
    return op.extract_uint64(a.bytes, const.BYTES24_LENGTH)
