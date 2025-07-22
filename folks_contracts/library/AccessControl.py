from algopy import BoxMap, Txn, op, subroutine
from algopy.arc4 import Address, Bool, Struct, abimethod, emit

from ..types import Bytes16
from .interfaces.IAccessControl import IAccessControl, RoleAdminChanged, RoleGranted, RoleRevoked

# Structs
class AddressRoleKey(Struct):
    role: Bytes16
    address: Address


class AccessControl(IAccessControl):
    """Contract module that allows children to implement role-based access control mechanisms. It is based on the
    OpenZeppelin equivalent contract.

    Roles are referred to by their `Bytes16` identifier. These should be exposed in the external API and be unique. The
    best way to achieve this is by using readonly ABI methods with hash digests:
    ```python
    @abimethod(readonly=True)
    def my_role(self) -> Bytes16:
        return Bytes16.from_bytes(op.extract(op.keccak256(b"MY_ROLE"), 0, 16))
    ```

    Roles can be used to represent a set of permissions. To restrict access to a method call, use {has_role}:
    ```python
    @abimethod
    def foo(self) -> None:
        assert self.has_role(role, Address(Txn.sender)), "Sender is missing role"
        ...
    ```

    There is also a subroutine {_check_role} for the common pattern of ensuring the transaction sender has a role:
    ```python
    @abimethod
    def foo(self) -> None:
        self._check_sender_role(self.my_role())
        ...
    ```
    Roles can be granted and revoked dynamically via the {grant_role} and {revoke_role} functions. Each role has an
    associated admin role, and only accounts that have a role's admin role can call {grant_role} and {revoke_role}.

    By default, the admin role for all roles is `{default_admin_role}`, which means that only accounts with this role
    will be able to grant or revoke other roles. More complex role relationships can be created by using
    {_set_role_admin}.

    WARNING: The `{default_admin_role}` is also its own admin: it has permission to grant and revoke this role. Extra
    precautions should be taken to secure accounts that have been granted it.
    """
    def __init__(self) -> None:
        # role -> role admin (which is itself a role)
        self.roles = BoxMap(Bytes16, Bytes16, key_prefix=b"role_")
        # (role, address) -> whether address has role
        self.addresses_roles = BoxMap(
            AddressRoleKey, Bool, key_prefix=b"address_roles_"
        )

    @abimethod
    def grant_role(self, role: Bytes16, account: Address) -> None:
        """Grant a role to an account

        Args:
            role: The role to grant
            account: The account to grant the role to

        Raises:
            AssertionError: If the sender doesn't have role's admin role.
        """
        self._check_sender_role(self.get_role_admin(role))
        self._grant_role(role, account)

    @abimethod
    def revoke_role(self, role: Bytes16, account: Address) -> None:
        """Revokes a role from an account

        Args:
            role: The role to revoke
            account: The account to revoke the role from

        Raises:
            AssertionError: If the sender doesn't have role's admin role.
        """
        self._check_sender_role(self.get_role_admin(role))
        self._revoke_role(role, account)

    @abimethod
    def renounce_role(self, role: Bytes16) -> None:
        """Revokes a role from the caller

        Args:
            role: The role to renounce
        """
        self._revoke_role(role, Address(Txn.sender))

    @abimethod(readonly=True)
    def default_admin_role(self) -> Bytes16:
        """Returns the role identifier for the default admin role

        Returns:
            Empty bytes of length 16
        """
        return Bytes16.from_bytes(op.bzero(16))

    @abimethod(readonly=True)
    def has_role(self, role: Bytes16, account: Address) -> Bool:
        """Returns whether the account has been granted a role

        Args:
            role: The role to check
            account: The account to check

        Returns:
            Whether the account has been granted a role
        """
        address_role_key = self._address_role_key(role, account)
        return Bool(address_role_key in self.addresses_roles) and self.addresses_roles[address_role_key]

    @abimethod(readonly=True)
    def get_role_admin(self, role: Bytes16) -> Bytes16:
        """Returns the admin role that controls a role

        Args:
            role: The role to get its admin of

        Returns:
            The role admin
        """
        if role not in self.roles:
            return self.default_admin_role()
        return self.roles[role]

    @subroutine(inline=False)
    def _set_role_admin(self, role: Bytes16, admin_role: Bytes16) -> None:
        """Sets a role's admin role.

        Args:
            role: The role whose admin role to set
            admin_role: The new admin role
        """
        previous_role_admin = self.get_role_admin(role)
        self.roles[role] = admin_role.copy()
        emit(RoleAdminChanged(role, previous_role_admin, admin_role))

    @subroutine
    def _address_role_key(self, role: Bytes16, account: Address) -> AddressRoleKey:
        return AddressRoleKey(role.copy(), account)

    @subroutine
    def _check_sender_role(self, role: Bytes16) -> None:
        self._check_role(role, Address(Txn.sender))

    @subroutine
    def _check_role(self, role: Bytes16, account: Address) -> None:
        assert self.has_role(role, account), "Access control unauthorised account"

    @subroutine
    def _grant_role(self, role: Bytes16, account: Address) -> Bool:
        # if new role then add the default admin role
        if role not in self.roles:
            self.roles[role] = self.default_admin_role()

        # grant role to account if it doesn't have
        if not self.has_role(role, account):
            address_role_key = self._address_role_key(role, account)
            self.addresses_roles[address_role_key] = Bool(True)
            emit(RoleGranted(role, account, Address(Txn.sender)))
            return Bool(True)
        else:
            return Bool(False)

    @subroutine
    def _revoke_role(self, role: Bytes16, account: Address) -> Bool:
        # revoke role from account if it does have
        if self.has_role(role, account):
            address_role_key = self._address_role_key(role, account)
            del self.addresses_roles[address_role_key]
            emit(RoleRevoked(role, account, Address(Txn.sender)))
            return Bool(True)
        else:
            return Bool(False)
