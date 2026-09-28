r"""把 D:\pic 的原文件按已核对的素材规则直接改名、归位并写入档案。

此脚本只处理当前 18 个 test 目录。移动前核对源文件、规范副本和迁移清单的 SHA-256，
目标文件一旦存在便停止，避免覆盖；移动后再次核对内容。
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(r"D:\pic").resolve()
BASE = Path(r"D:\myproject\aipic\.local\mcp_test").resolve()
SNAPSHOT = BASE / "materials"
COPY_MAP = BASE / "migration-map.json"
DIRECT_MAP = BASE / "direct-layout-map.json"


# 逐块计算文件校验值，确保改名和移动没有改变图片内容。
def sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


# 将前次规范副本中的旧来源字段改为原始路径字段，避免误认为旧位置仍可读取。
def mark_original_paths(value: object) -> object:
    if isinstance(value, list):
        return [mark_original_paths(item) for item in value]
    if isinstance(value, dict):
        converted = {}
        for key, item in value.items():
            new_key = {
                "sourceDirectory": "originalDirectory",
                "sourceRelativePath": "originalRelativePath",
            }.get(key, key)
            converted[new_key] = mark_original_paths(item)
        return converted
    return value


# 预先核对所有源、目标与快照路径，生成完整的逐文件移动计划。
def prepare_plan() -> tuple[list[dict], dict, list[tuple[Path, dict]], str]:
    if not ROOT.is_dir() or not BASE.is_dir() or not SNAPSHOT.is_dir():
        raise ValueError("源目录或规范副本不存在")
    if ROOT.is_symlink() or BASE.is_symlink() or DIRECT_MAP.exists():
        raise ValueError("目录是符号链接或本次直接迁移已经执行")
    expected_root_names = {f"test{number}" for number in range(1, 19)} | {"test.md"}
    actual_root_names = {entry.name for entry in ROOT.iterdir()}
    if actual_root_names != expected_root_names:
        raise ValueError(f"D:\\pic 根目录不是已盘点的原始状态：{sorted(actual_root_names)}")
    copy_map = json.loads(COPY_MAP.read_text(encoding="utf-8"))
    if copy_map["sourceRoot"].casefold() != str(ROOT).casefold() or len(copy_map["files"]) != 48:
        raise ValueError("前次迁移清单与当前源目录不符")
    catalog = json.loads((SNAPSHOT / "catalog.json").read_text(encoding="utf-8"))
    if len(catalog["templates"]) != 18:
        raise ValueError("模板索引不是 18 项")
    manifests = []
    for template in catalog["templates"]:
        directory = SNAPSHOT / template["directory"]
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        if manifest["templateTypeId"] != template["templateTypeId"]:
            raise ValueError(f"模板索引与档案编号不一致：{directory}")
        manifests.append((ROOT / template["directory"], mark_original_paths(manifest)))

    plan = []
    seen_sources: set[Path] = set()
    seen_targets: set[Path] = set()
    for file_record in copy_map["files"]:
        source = (ROOT / file_record["source"]).resolve(strict=True)
        snapshot = (BASE / file_record["destination"]).resolve(strict=True)
        parts = Path(file_record["destination"]).parts
        if not parts or parts[0] != "materials":
            raise ValueError("规范副本路径未位于 materials 下")
        target = (ROOT.joinpath(*parts[1:])).resolve(strict=False)
        if (
            not source.is_relative_to(ROOT)
            or not snapshot.is_relative_to(SNAPSHOT)
            or not target.is_relative_to(ROOT)
            or source.is_symlink()
            or snapshot.is_symlink()
            or target.exists()
            or source in seen_sources
            or target in seen_targets
        ):
            raise ValueError(f"移动路径不安全、重复或目标已存在：{source} -> {target}")
        digest = file_record["sha256"]
        if sha256(source) != digest or sha256(snapshot) != digest:
            raise ValueError(f"源文件与规范副本不一致：{source}")
        seen_sources.add(source)
        seen_targets.add(target)
        plan.append({
            "oldPath": file_record["source"],
            "newPath": target.relative_to(ROOT).as_posix(),
            "sha256": digest,
            "sizeBytes": file_record["sizeBytes"],
        })
    if len(plan) != 48:
        raise ValueError("图片移动计划数量不符")
    actual_files = {file.resolve(strict=True) for file in ROOT.rglob("*") if file.is_file()}
    expected_files = seen_sources | {(ROOT / "test.md").resolve(strict=True)}
    if actual_files != expected_files:
        raise ValueError("D:\\pic 存在未纳入移动计划的文件，或计划引用了不存在的文件")
    note_digest = sha256(ROOT / "test.md")
    if note_digest != sha256(BASE / "source-notes" / "test.md"):
        raise ValueError("原始模板说明与保留副本不一致")
    return plan, mark_original_paths(catalog), manifests, note_digest


# 写入新的 JSON 档案；所有图片已经在目标位置核对后才调用。
def write_json(file_path: Path, value: object) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# 执行逐文件归位，核对所有目标，再移走旧说明文档并清理空目录。
def main() -> None:
    plan, catalog, manifests, note_digest = prepare_plan()
    for record in plan:
        source = ROOT / record["oldPath"]
        target = ROOT / record["newPath"]
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            raise ValueError(f"目标文件已存在：{target}")
        source.rename(target)
        if sha256(target) != record["sha256"]:
            raise ValueError(f"移动后内容不一致：{target}")

    # 逐份检查档案引用，确保所写路径就是 D:\pic 下的现有文件。
    for directory, manifest in manifests:
        records = []
        friend = manifest["competitorReference"]
        if friend is not None:
            records.extend(friend["inputs"])
            records.extend(friend["effects"])
        for image_set in manifest["imageSets"]:
            records.extend(image_set["inputs"])
        for item in records:
            target = (directory / item["path"]).resolve(strict=True)
            if not target.is_relative_to(directory) or sha256(target) != item["sha256"]:
                raise ValueError(f"档案引用图片缺失或内容不符：{target}")
        write_json(directory / "manifest.json", manifest)
    write_json(ROOT / "catalog.json", catalog)

    note_target = ROOT / "source-notes" / "test.md"
    note_target.parent.mkdir(parents=True, exist_ok=True)
    (ROOT / "test.md").rename(note_target)
    if sha256(note_target) != note_digest:
        raise ValueError("模板说明移动后内容不一致")

    # 只删除已经确认空置的旧目录，不递归删除任何素材。
    for name in ("testexample1", "testexample2"):
        (ROOT / "test1" / name).rmdir()
    for number in range(1, 19):
        (ROOT / f"test{number}").rmdir()

    write_json(DIRECT_MAP, {
        "schemaVersion": 1,
        "movedAt": datetime.now(timezone.utc).isoformat(),
        "root": str(ROOT),
        "files": plan,
        "sourceNote": {
            "oldPath": "test.md",
            "newPath": "source-notes/test.md",
            "sha256": note_digest,
        },
        "snapshotPreservedAt": str(SNAPSHOT),
    })
    print(f"已在 D:\\pic 归位 {len(plan)} 张图片，建立 {len(manifests)} 份模板档案。")


if __name__ == "__main__":
    main()
