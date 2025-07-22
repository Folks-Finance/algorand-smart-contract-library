from algopy.arc4 import abimethod

from ..extensions.InitialisableWithCreator import InitialisableWithCreator


class MockInitialisableWithCreator(InitialisableWithCreator):
    def __init__(self) -> None:
        InitialisableWithCreator.__init__(self)

    @abimethod
    def initialise(self) -> None:
        super().initialise()
