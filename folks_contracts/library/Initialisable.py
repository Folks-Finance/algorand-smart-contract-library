from abc import ABC, abstractmethod
from algopy import subroutine
from algopy.arc4 import abimethod

from .interfaces.IInitialisable import IInitialisable


class Initialisable(IInitialisable, ABC):
    """Contract that allows children to be initialised.

    There are two main use cases for this contract:
        1. Initialising the contract when its application account requires funding.
        2. Initialising an Upgradeable contract upon a new version.

    For the first use case, each deployed application in Algorand has an associated account. Often this account needs
    to be funded e.g. to pay for box storage, to opt into an asset etc, however the address is not known until after
    deployment. With this contract you move this code which requires a balance to the {initialise} method.

    For the second use case, after an Upgradeable contract goes to a new version, some state may need to be cleaned up
    and/or created between upgrades. The {initialise} method acts similar to an on-creation method in that it
    guarantees to be called only once.

    The ABI method initialise is an abstract method because the user of the library will have different parameters and
    logic according to their use case. To avoid compiler errors when implementing the abstract method with different
    parameters, you must provide the following hint as so:
    ```python
    @abimethod
    def initialise(self, admin: Address) -> None: # type: ignore[override]
        super().initialise()
        ...
    ```

    There is also a subroutine {_only_initialised} for the common pattern of ensuring the contract has been initialised
    before an ABI method can be invoked:
    ```python
    @abimethod
    def foo(self) -> None:
        self._only_initialised()
        ...
    ```

    """
    def __init__(self) -> None:
        self.is_initialised = False

    @abstractmethod
    @abimethod
    def initialise(self) -> None:
        """Initialise the contract.
        Override this method with additional args needed, calling super for common implementation.

        IMPORTANT: make sure to check the sender in the child contract if parameters are being passed.

        Raises:
            AssertionError: If the contract is already initialised
        """
        assert not self.is_initialised, "Contract already initialised"

        self.is_initialised = True

    @subroutine
    def _only_initialised(self) -> None:
        assert self.is_initialised, "Uninitialised contract"
