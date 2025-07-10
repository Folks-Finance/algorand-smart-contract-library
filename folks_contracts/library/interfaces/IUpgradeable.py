from abc import ABC, abstractmethod
from algopy import ARC4Contract, UInt64
from algopy.arc4 import Struct, abimethod

from ...types import ARC4UInt64, Bytes32

# Events
class UpgradeScheduled(Struct):
    program_sha256: Bytes32
    timestamp: ARC4UInt64

class UpgradeCancelled(Struct):
    timestamp: ARC4UInt64

class UpgradeCompleted(Struct):
    program_sha256: Bytes32
    version: ARC4UInt64


class IUpgradeable(ARC4Contract, ABC):
    @abstractmethod
    @abimethod
    def schedule_contract_upgrade(self, program_sha256: Bytes32, timestamp: UInt64) -> None:
        pass

    @abstractmethod
    @abimethod
    def cancel_contract_upgrade(self) -> None:
        pass

    @abstractmethod
    @abimethod(allow_actions=["UpdateApplication"])
    def complete_contract_upgrade(self) -> None:
        pass
