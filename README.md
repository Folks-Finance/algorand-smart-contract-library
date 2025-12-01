# algorand-smart-contract-library

## Overview

The Folks Smart Contract Library is a curated, modular collection of audited, reusable smart contracts designed to accelerate development on the Algorand blockchain. The library allows you to focus on your business logic by abstracting away common patterns and security mechanisms.

Please refer to the official [documentation](https://docs.google.com/document/d/1asxwEYzNtG2cTTvuTwBszMmEUKMtkL8s7bBROeD1LlU/edit?usp=sharing) for further details.

## Getting Started

To use the Smart Contract Library in your own Algorand Python contracts, run the command:

```bash
pip3 install git+https://github.com/Folks-Finance/algorand-smart-contract-library.git
```

then you can simply import the contracts like so:

```python
from folks_contracts.library.AccessControl import AccessControl

class ExampleContract(AccessControl):
    ...
```

## Requirements

- Linux or macOS
- Python 3
- AlgoKit

## Setup

To install all required packages, run:

```bash
python3 -m venv venv
source venv/bin/activate
python3 -m pip install -r requirements.txt
```

```bash
npm install
```

## Compilation

To generate the TEAL code, ARC56 specs and TS clients for the contracts, run the command:

```bash
npm run build
```

## Testing

Start an Algorand localnet with AlgoKit and Docker using:

```bash
algokit localnet start
```

Make sure to run the compilation commands before testing.

Run all tests from root directory using:

```bash
npm run test
```

or single test file using:

```bash
PYTHONPATH="./contracts" npx jest <PATH_TO_TEST_FILE>
```

It is not possible to run the tests in parallel so `--runInBand` option is passed.
