from abc import ABC
from algopy import Bytes, Global, GlobalState, Txn, UInt64, op, subroutine, urange
from algopy.arc4 import Struct, abimethod, emit

from ..types import ARC4UInt64, Bytes16, Bytes32
from .AccessControl import AccessControl
from .Initialisable import Initialisable
from .interfaces.IUpgradeable import IUpgradeable, UpgradeScheduled, UpgradeCancelled, UpgradeCompleted


# Structs
class ScheduledContractUpgrade(Struct):
    program_sha256: Bytes32
    timestamp: ARC4UInt64

class MinimumUpgradeDelay(Struct):
    # active_delay = delay_1 if Global.latest_timestamp >= timestamp else delay_0
    delay_0: ARC4UInt64
    delay_1: ARC4UInt64
    timestamp: ARC4UInt64


# Events
class MinimumUpgradeDelayChange(Struct):
    delay: ARC4UInt64
    timestamp: ARC4UInt64


class Upgradeable(IUpgradeable, AccessControl, Initialisable, ABC):
    """Contract module that allows children to implement scheduled upgrade mechanisms.

    A contract upgrade must be scheduled at least "min upgrade delay" time in the future. Changes to the "min upgrade
    delay" must similarly wait.

    If there is a change scheduled and a new scheduled change is submitted, the old change will be overwritten by the
    new change.

    The maximum size of programs on Algorand is 8192 bytes (approval + clear). However, the maximum byte width of the
    Algorand Virtual Machine is 4096 bytes. Therefore to get around these limits, we use a hash of the contract to
    upgrade to:
        program_sha256 = sha256(
            “approval”,
            sha256(approval_program_page_0),
            sha256(approval_program_page_1),
            …
            “clear”
            sha256(clear_program_page_0),
            sha256(clear_program_page_1),
            …
        )

    It is the responsibility of the child contract to grant the `{upgradable_admin_role}`. The `initialise()` ABI
    method, which is left abstract, is the recommended place to do this. If the `{upgradable_admin_role}` is ungranted
    then no account will be able to upgrade the contract.
    """
    def __init__(self) -> None:
        AccessControl.__init__(self)
        Initialisable.__init__(self)
        self.min_upgrade_delay = GlobalState(MinimumUpgradeDelay)
        self.scheduled_contract_upgrade = GlobalState(ScheduledContractUpgrade)
        self.version = UInt64(1)

    @abimethod(create="require")
    def create(self, min_upgrade_delay: UInt64) -> None:
        self.min_upgrade_delay.value = MinimumUpgradeDelay(ARC4UInt64(0), ARC4UInt64(min_upgrade_delay), ARC4UInt64(0))

    @abimethod
    def update_min_upgrade_delay(self, min_upgrade_delay: UInt64, timestamp: UInt64) -> None:
        """Schedule a change in the minimum delay needed for an upgrade.
        Automatically comes into effect at given timestamp.

        Args:
            min_upgrade_delay (UInt64): The new delay
            timestamp (UInt64): The timestamp to schedule the change

        Raises:
            AssertionError: If the contract is not initialised
            AssertionError: If the caller does not have the upgradable admin role
            AssertionError: If the timestamp is not sufficiently in the future
        """
        self._only_initialised()
        self._check_sender_role(self.upgradable_admin_role())

        # ensure timestamp is sufficiently in the future
        self._check_schedule_timestamp(timestamp)

        # if it's active, free up delay_1 to write to it
        if Global.latest_timestamp >= self.min_upgrade_delay.value.timestamp:
            self.min_upgrade_delay.value.delay_0 = self.min_upgrade_delay.value.delay_1

        # schedule delay change, possibly overriding exising scheduled delay change
        self.min_upgrade_delay.value.delay_1 = ARC4UInt64(min_upgrade_delay)
        self.min_upgrade_delay.value.timestamp = ARC4UInt64(timestamp)

        emit(MinimumUpgradeDelayChange(ARC4UInt64(min_upgrade_delay), ARC4UInt64(timestamp)))

    @abimethod
    def schedule_contract_upgrade(self, program_sha256: Bytes32, timestamp: UInt64) -> None:
        """Schedule the upgrade of the contract.

        Args:
            program_sha256 (Bytes32): The SHA256 of the new program
            timestamp (UInt64): The timestamp to schedule the upgrade

        Raises:
            AssertionError: If the contract is not initialised
            AssertionError: If the caller does not have the upgradable admin role
            AssertionError: If the timestamp is not sufficiently in the future
        """
        self._only_initialised()
        self._check_sender_role(self.upgradable_admin_role())

        # ensure timestamp is sufficiently in the future
        self._check_schedule_timestamp(timestamp)

        # schedule contract upgrade, possibly overriding existing scheduled upgrade
        self.scheduled_contract_upgrade.value = ScheduledContractUpgrade(program_sha256.copy(), ARC4UInt64(timestamp))

        emit(UpgradeScheduled(program_sha256, ARC4UInt64(timestamp)))

    @abimethod
    def cancel_contract_upgrade(self) -> None:
        """Cancel the scheduled upgrade

        Raises:
            AssertionError: If the contract is not initialised
            AssertionError: If the caller does not have the upgradable admin role
            AssertionError: If there is no upgrade scheduled
        """
        self._only_initialised()
        self._check_sender_role(self.upgradable_admin_role())

        # delete scheduled upgrade
        self._check_upgrade_scheduled()
        del self.scheduled_contract_upgrade.value

        emit(UpgradeCancelled(ARC4UInt64(Global.latest_timestamp)))

    @abimethod(allow_actions=["UpdateApplication"])
    def complete_contract_upgrade(self) -> None:
        """Complete the scheduled upgrade
        Anyone can call this method.

        Raises:
            AssertionError: If the contract is not initialised
            AssertionError: If the complete upgrade timestamp is not met
            AssertionError: If the contract SHA256 is not valid
        """
        self._only_initialised()

        # check timestamp has been met
        self._check_upgrade_scheduled()
        scheduled_contract_upgrade = self.scheduled_contract_upgrade.value.copy()
        assert Global.latest_timestamp >= scheduled_contract_upgrade.timestamp, "Schedule complete ts not met"

        # check we are upgrading to same contract
        program = Bytes(b"approval")
        for page_index in urange(Txn.num_approval_program_pages):
            program += op.sha256(Txn.approval_program_pages(page_index))
        program += Bytes(b"clear")
        for page_index in urange(Txn.num_clear_state_program_pages):
            program += op.sha256(Txn.clear_state_program_pages(page_index))
        program_sha256 = Bytes32.from_bytes(op.sha256(program))
        assert scheduled_contract_upgrade.program_sha256 == program_sha256, "Invalid program SHA256"

        # reset to new contract version
        del self.scheduled_contract_upgrade.value
        self.version += UInt64(1)
        self.is_initialised = False

        emit(UpgradeCompleted(program_sha256, ARC4UInt64(self.version)))

    @abimethod(readonly=True)
    def upgradable_admin_role(self) -> Bytes16:
        """Returns the role identifier for the upgradeable admin role

        Returns:
            Role bytes of length 16
        """
        return Bytes16.from_bytes(op.extract(op.keccak256(b"UPGRADEABLE_ADMIN"), 0, 16))

    @abimethod(readonly=True)
    def get_active_min_upgrade_delay(self) -> UInt64:
        """Clarifies the active minimum upgrade delay in cases where there was a scheduled update.

        Returns:
            The active minimum upgrade delay
        """
        min_upgrade_delay = self.min_upgrade_delay.value.copy()
        return (
            min_upgrade_delay.delay_1 if Global.latest_timestamp >= min_upgrade_delay.timestamp
            else min_upgrade_delay.delay_0
        ).native

    @subroutine
    def _check_schedule_timestamp(self, timestamp: UInt64) -> None:
        assert (
            timestamp >= Global.latest_timestamp + self.get_active_min_upgrade_delay()
        ), "Must schedule at least min upgrade delay time in future"

    @subroutine
    def _check_upgrade_scheduled(self) -> None:
        exists = self.scheduled_contract_upgrade.maybe()[1]
        assert exists, "Upgrade not scheduled"
