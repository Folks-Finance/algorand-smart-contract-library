import setuptools


with open("README.md", "r") as f:
    long_description = f.read()

setuptools.setup(
    name="algorand-smart-contract-library",
    description="Smart Contract Library in Algorand Python",
    author="Folks Finance",
    version="0.0.1",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/Folks-Finance/algorand-smart-contract-library",
    license="MIT",
    project_urls={
        "Source": "https://github.com/Folks-Finance/algorand-smart-contract-library",
    },
    install_requires=[
        "algokit>=2.9.1,<3",
        "algorand-python>=3.0.0,<4",
        "puyapy>=5.0.1,<6",
    ],
    packages=setuptools.find_packages(
        include=(
            "folks_contracts",
            "folks_contracts.*",
        )
    ),
    python_requires=">=3.12",
    package_data={"folks_contracts": ["py.typed"]},
    include_package_data=True
)
