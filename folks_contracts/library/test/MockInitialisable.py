from algopy import UInt64
from algopy.arc4 import abimethod

from ..Initialisable import Initialisable


class MockInitialisable(Initialisable):
    def __init__(self) -> None:
        Initialisable.__init__(self)
        self.counter = UInt64(0)

    @abimethod
    def initialise(self, initial_counter: UInt64) -> None: # type: ignore[override]
        super().initialise()
        self.counter = initial_counter

    @abimethod
    def can_only_be_called_when_initialised(self) -> None:
        self._only_initialised()
