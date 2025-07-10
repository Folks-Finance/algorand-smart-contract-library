from abc import ABC, abstractmethod
from algopy import ARC4Contract
from algopy.arc4 import abimethod

class IInitialisable(ARC4Contract, ABC):
    @abstractmethod
    @abimethod
    def initialise(self) -> None:
        pass
