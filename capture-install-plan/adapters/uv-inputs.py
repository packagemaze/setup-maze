"""Read the authored Project selector and source kinds for packages selected by uv."""
import json
import sys
try:
    import tomllib
except ModuleNotFoundError:
    from pip._vendor import tomli as tomllib
from pathlib import Path


def load(path):
    with Path(path).open("rb") as source:
        return tomllib.load(source)


manifest, lock = (load(path) for path in sys.argv[1:])
# Only source kinds and authored local paths are needed to join uv's result.
# Registry URLs and credentials never reach the receipt.
packages = []
for package in lock["package"]:
    source = package["source"]
    kinds = {
        key: value if key in {"editable", "directory", "path"} else ""
        for key, value in source.items()
        if key in {"registry", "git", "url", "editable", "directory", "path"}
    }
    packages.append([package["name"], package.get("version"), kinds])
print(json.dumps({"member": manifest["project"]["name"], "packages": packages}))
