from algopy import UInt64, subroutine, uenumerate
from algopy.arc4 import Bool, DynamicArray
from typing import Tuple

from ..types import ARC4UInt64


"""Library for a set of UInt64 values. Implemented using dynamic arrays.

Note only supports up to 511 items because item on stack cannot exceed 4098 bytes.
"""
@subroutine
def has_item(to_search: UInt64, items: DynamicArray[ARC4UInt64]) -> Bool:
    for item in items:
        if item.native == to_search:
            return Bool(True)
    return Bool(False)

@subroutine
def add_item(to_add: UInt64, items: DynamicArray[ARC4UInt64]) -> Tuple[Bool, DynamicArray[ARC4UInt64]]:
    # check if already added in which case skip
    for item in items:
        if item.native == to_add:
            # already added
           return Bool(False), items.copy()

    # if here then item is not present so must be added
    items.append(ARC4UInt64(to_add))
    return Bool(True), items.copy()

@subroutine
def remove_item(to_remove: UInt64, items: DynamicArray[ARC4UInt64]) -> Tuple[Bool, DynamicArray[ARC4UInt64]]:
    last_idx = items.length - 1
    for idx, item in uenumerate(items):
        if item.native == to_remove:
            # remove last item to replace the "to_remove" item or remove entirely if it's the match
            last_item = items.pop()
            if idx != last_idx:
                items[idx] = last_item
            # return with the item removed
            return Bool(True), items.copy()

    # if here then item is not present
    return Bool(False), items.copy()
