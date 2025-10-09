from algopy import UInt64, op, subroutine

from ..types import Bytes32


"""Library to convert between `uint64` and `Bytes32`."""
@subroutine
def convert_uint64_to_bytes32(a: UInt64) -> Bytes32:
    return Bytes32.from_bytes(op.replace(op.bzero(32), 24, op.itob(a)))

@subroutine
def safe_convert_bytes32_to_uint64(a: Bytes32) -> UInt64:
    assert op.substring(a.bytes, 0, 24) == op.bzero(24), "Unsafe conversion of bytes32 to uint64"
    return op.extract_uint64(a.bytes, 24)
