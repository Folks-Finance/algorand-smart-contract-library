from abc import ABC, abstractmethod
from algopy import ARC4Contract
from algopy.arc4 import Address, Bool, Struct, abimethod

from ...types import Bytes16


# Events
class RoleAdminChanged(Struct):
    role: Bytes16
    prev_admin_role: Bytes16
    new_admin_role: Bytes16

class RoleGranted(Struct):
    role: Bytes16
    account: Address
    sender: Address

class RoleRevoked(Struct):
    role: Bytes16
    account: Address
    sender: Address


class IAccessControl(ARC4Contract, ABC):
    @abstractmethod
    @abimethod
    def grant_role(self, role: Bytes16, account: Address) -> None:
        pass

    @abstractmethod
    @abimethod
    def revoke_role(self, role: Bytes16, account: Address) -> None:
        pass

    @abstractmethod
    @abimethod
    def renounce_role(self, role: Bytes16) -> None:
        pass

    @abstractmethod
    @abimethod(readonly=True)
    def has_role(self, role: Bytes16, account: Address) -> Bool:
        pass

    @abstractmethod
    @abimethod(readonly=True)
    def get_role_admin(self, role: Bytes16) -> Bytes16:
        pass

