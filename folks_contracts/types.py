from algopy.arc4 import (
    Byte,
    StaticArray,
    UInt8 as ARC4UInt8,
    UInt16 as ARC4UInt16,
    UInt64 as ARC4UInt64,
    UInt256 as ARC4UInt256,
)
from typing import Literal, TypeAlias

Bytes8: TypeAlias = StaticArray[Byte, Literal[8]]
Bytes16: TypeAlias = StaticArray[Byte, Literal[16]]
Bytes32: TypeAlias = StaticArray[Byte, Literal[32]]
