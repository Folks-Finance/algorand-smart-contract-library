from algopy.arc4 import Address, abimethod

from ...types import Bytes16
from ..AccessControl import AccessControl
from ..Initialisable import Initialisable

class MockAccessControl(AccessControl, Initialisable):
    def __init__(self) -> None:
        AccessControl.__init__(self)
        Initialisable.__init__(self)

    @abimethod
    def initialise(self, admin: Address) -> None: # type: ignore[override]
        super().initialise()
        self._grant_role(self.default_admin_role(), admin)

    @abimethod
    def set_role_admin(self, role: Bytes16, admin_role: Bytes16) -> None:
        self._set_role_admin(role, admin_role)

    @abimethod
    def check_sender_role(self, role: Bytes16) -> None:
        self._check_sender_role(role)

    @abimethod
    def check_role(self, role: Bytes16, account: Address) -> None:
        self._check_role(role, account)
