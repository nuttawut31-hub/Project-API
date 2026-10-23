"""Package only runnable Phase 3 source and evidence; omit local secrets/dependencies."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root / "submissions" / "project-phase3-67160028-9.zip"
excluded_dirs = {"node_modules", "coverage", "__pycache__", ".git", "lesson"}
excluded_files = {".env", ".env.local", ".demo-credentials", "backend/index.js"}
files = [root / "README.md"]
for folder in ("backend", "frontend", "docs"):
    files.extend(path for path in (root / folder).rglob("*") if path.is_file()
                 and not any(part in excluded_dirs for part in path.relative_to(root).parts)
                 and path.name not in excluded_files
                 and path.relative_to(root).as_posix() not in excluded_files)

with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, file.relative_to(root).as_posix())

with ZipFile(output) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert all("node_modules" not in name and Path(name).name not in {".env", ".env.local", ".demo-credentials"} for name in names)
print(f"Created {output.name}: {len(files)} files, {output.stat().st_size} bytes; secrets excluded")
