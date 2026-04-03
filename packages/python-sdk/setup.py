from setuptools import setup, find_packages

setup(
    name="prompttrace",
    version="0.1.0",
    description="Python SDK for Prompttrace",
    packages=find_packages(),
    install_requires=[
        "tiktoken>=0.6.0",
        "openai>=1.0.0"
    ],
    python_requires=">=3.8",
)
