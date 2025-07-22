from abc import ABC, abstractmethod
from algopy import Global, Txn
from algopy.arc4 import abimethod

from ..Initialisable import Initialisable


class InitialisableWithCreator(Initialisable, ABC):
    """Extension to Initialisable Contract which ensures caller of "initialise" method is contract creator."""
    def __init__(self) -> None:
        Initialisable.__init__(self)

    @abstractmethod
    @abimethod
    def initialise(self) -> None:
        """Initialise the contract.
        Override this method with additional args needed, calling super for common implementation.

        Adds check to ensure caller is the contract creator.

        Raises:
            AssertionError: If the caller is not the contract creator
            AssertionError: If the contract is already initialised
        """
        assert Txn.sender == Global.creator_address, "Caller must be the contract creator"
        Initialisable.initialise(self)
