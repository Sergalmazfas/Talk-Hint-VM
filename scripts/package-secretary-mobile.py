#!/usr/bin/env python3
"""Export only the existing Secretary client; never export the TalkHint server."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "apps/secretary-mobile"


def package(backend_origin: str, output: Path) -> dict:
    url = urlsplit(backend_origin)
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.path not in ("", "/")
        or url.query
        or url.fragment
        or url.hostname == "talkhint.app"
        or url.hostname.endswith(".talkhint.app")
    ):
        raise ValueError("Supply a development HTTPS origin only, not production.")
    origin = f"https://{url.netloc}"
    # Explicit allowlist: no root backend, env, node_modules, credentials or history.
    files = ["App.tsx", "package.json", "package-lock.json", "tsconfig.json", "eas.json"]
    files += [
        str(path.relative_to(SOURCE))
        for path in sorted((SOURCE / "src").rglob("*"))
        if path.is_file() and path.suffix in (".ts", ".tsx")
    ]
    contents = {}
    for name in files:
        path = SOURCE / name
        if path.is_symlink():
            raise ValueError(f"Refusing symlink: {name}")
        contents[name] = path.read_bytes()
    config = json.loads((SOURCE / "app.json").read_text())
    # The original export lives at /secretary-preview/. A new project is root-based.
    config["expo"].get("experiments", {}).pop("baseUrl", None)
    contents["app.json"] = (json.dumps(config, indent=2) + "\n").encode()
    contents[".env.example"] = (
        "# Public Dev backend URL, NOT an API key. Never put server secrets here.\n"
        f"EXPO_PUBLIC_API_ORIGIN={origin}\n"
    ).encode()
    contents[".gitignore"] = (
        "node_modules/\n.expo/\ndist/\nweb-build/\nios/\nandroid/\n"
        ".env\n.env.*\n!.env.example\n*.jks\n*.keystore\n*.p12\n*.mobileprovision\n"
        "credentials.json\n*.log\n"
    ).encode()
    contents["README.md"] = (ROOT / "docs/roadmap/secretary-mobile-import.md").read_bytes()
    contents["AGENTS.md"] = f"""# Standalone TalkHint Secretary mobile project

This is a complete existing Expo SDK 54 / React Native client, not a web app
to redesign. Configure this NEW project as a native mobile app in Replit.
Do not migrate or import the original TalkHint backend/laboratory.

## Setup
- Use the existing package.json and lockfile. Install the dependencies.
- Copy .env.example to .env for the public Dev API origin: {origin}
- Native preview/development build is the primary test target.
- Register the mobile preview/build tools supported by this new workspace.
  Merely running a web workflow does not prove native registration.
- Explain any mobile build UI blocker instead of inventing a successful build.
- Do not initiate paid builds, store upload or provider/account changes.

## Boundary
The external TalkHint Dev server must remain running. API namespace:
/api/mobile-secretary/*. Real calls, SMS, push, calendar writes and payments
are not enabled. TEST confirmation creates only a durable TEST task.
Do not copy backend secrets into EXPO_PUBLIC variables or this project.
Keep bundle IDs com.talkhint.secretaryclient.dev and the
talkhintsecretaryclient URL scheme unless the owner authorizes a change.
Preserve Secretary/Cards/History/Settings and existing direct OpenAI choices.
No Twilio Voice SDK, CallKit, Translator, Hint, Copilot, Tutor, Retell or clones.

## Checks and limitations
Run npm run typecheck; export bundles for iOS/Android/web.
eas.json has internal development/preview profiles, not a production release.
Apple/Expo linking and signing must be performed by the owner securely.
Never ask for Apple passwords or server tokens in chat.
Native builds and microphone/Google/device behavior require device proof.
Separate-origin web API access is deliberately denied by the existing backend
CORS guard. Do not weaken that guard. Use native preview; the existing backend
also hosts a same-origin web preview at {origin}/secretary-preview/.
""".encode()
    hashes = {
        name: hashlib.sha256(data).hexdigest()
        for name, data in sorted(contents.items())
    }
    contents["EXPORT-MANIFEST.json"] = (
        json.dumps(
            {
                "format": 1,
                "scope": "standalone-secretary-client-only",
                "backendOrigin": origin,
                "nativeBuildVerified": False,
                "sha256": hashes,
            },
            indent=2,
        ) + "\n"
    ).encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(contents.items()):
            entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
    return {"path": str(output.relative_to(ROOT)), "files": len(contents), "bytes": output.stat().st_size}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend-origin", required=True)
    parser.add_argument(
        "--output", type=Path,
        default=ROOT / "generated-artifacts/talkhint-secretary-mobile.zip",
    )
    args = parser.parse_args()
    print(json.dumps(package(args.backend_origin, args.output.resolve())))
