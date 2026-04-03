import os
from setuptools import setup, find_packages

# Read the local README
readme_path = os.path.join(os.path.dirname(__file__), "README.md")
with open(readme_path, "r", encoding="utf-8") as f:
    long_description = f.read()

setup(
    name="prompttrace-sdk",
    version="0.1.0",
    description="Python SDK for Prompttrace: Local-first LLM observability and prompt optimization.",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="Ameya Kulkarni",
    url="https://github.com/amEya911/prompttrace",
    packages=find_packages(),
    install_requires=[
        "tiktoken>=0.6.0",
        "openai>=1.0.0"
    ],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Intended Audience :: Developers",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
    ],
    python_requires=">=3.8",
)
