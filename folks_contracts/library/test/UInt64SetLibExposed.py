from algopy import Box, UInt64, ensure_budget
from algopy.arc4 import ARC4Contract, Bool, DynamicArray, abimethod
from typing import Tuple

from ...types import ARC4UInt64
from .. import UInt64SetLib


class UInt64SetLibExposed(ARC4Contract):
    def __init__(self) -> None:
        self.uint64_set = Box(DynamicArray[ARC4UInt64], key="uint64_set")

    @abimethod(readonly=True)
    def dynamic_has_item(self, to_search: UInt64) -> Bool:
        return UInt64SetLib.has_item(to_search, self.uint64_set.value.copy())

    @abimethod
    def dynamic_reset(self) -> None:
        self.uint64_set.value = DynamicArray[ARC4UInt64]()

    @abimethod
    def dynamic_add_item(self, to_add: UInt64) -> Bool:
        ensure_budget(10000)
        added, new_items = UInt64SetLib.add_item(to_add, self.uint64_set.value.copy())
        self.uint64_set.value = new_items.copy()
        return added

    @abimethod
    def dynamic_remove_item(self, to_remove: UInt64) -> Bool:
        ensure_budget(10000)
        removed, new_items = UInt64SetLib.remove_item(to_remove, self.uint64_set.value.copy())
        self.uint64_set.value = new_items.copy()
        return removed

    @abimethod(readonly=True)
    def has_item(self, to_search: UInt64, items: DynamicArray[ARC4UInt64]) -> Bool:
        return UInt64SetLib.has_item(to_search, items)

    @abimethod(readonly=True)
    def add_item(self, to_add: UInt64, items: DynamicArray[ARC4UInt64]) -> Tuple[Bool, DynamicArray[ARC4UInt64]]:
        return UInt64SetLib.add_item(to_add, items)

    @abimethod(readonly=True)
    def remove_item(self, to_remove: UInt64, items: DynamicArray[ARC4UInt64]) -> Tuple[Bool, DynamicArray[ARC4UInt64]]:
        return UInt64SetLib.remove_item(to_remove, items)
