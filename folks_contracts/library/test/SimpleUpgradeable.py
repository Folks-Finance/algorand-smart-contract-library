from algopy.arc4 import Address, abimethod

from ..extensions.InitialisableWithCreator import InitialisableWithCreator
from ..Upgradeable import Upgradeable


class SimpleUpgradeable(Upgradeable, InitialisableWithCreator):
    def __init__(self) -> None:
        Upgradeable.__init__(self)

    @abimethod
    def initialise(self, admin: Address) -> None: # type: ignore[override]
        InitialisableWithCreator.initialise(self)

        self._grant_role(self.default_admin_role(), admin)
        self._grant_role(self.upgradable_admin_role(), admin)
