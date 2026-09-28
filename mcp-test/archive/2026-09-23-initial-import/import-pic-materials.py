r"""把 D:\pic 的友商参考和两组测试图复制到受控素材目录，并留下校验清单。

源文件始终保留。此脚本只用于 2026-09-23 的一次性导入；若目标目录已存在则停止，
避免覆盖人工调整后的素材或档案。
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path


SOURCE = Path(r"D:\pic").resolve()
BASE = Path(r"D:\myproject\aipic\.local\mcp_test").resolve()
TARGET = BASE / "materials"
HISTORICAL_EXECUTION = "2ca7abe3-5bdd-4303-b34e-9d57ec2e5d6d"
HISTORICAL_REPORT = BASE / ".." / "codex-template-mcp" / "outputs" / HISTORICAL_EXECUTION / "report.json"
SUPPLEMENTAL_DESCRIPTION = "让图一人物参考图二一样手持冰袋"

TEMPLATES = [
    (1, "动作模仿", "action-imitation"),
    (2, "双眼皮固定医用胶带", "eyelid-medical-tape"),
    (3, "医美机构双人合影", "clinic-two-person-photo"),
    (4, "操作室人物融合", "treatment-room-integration"),
    (5, "咨询室人物融合", "consultation-room-integration"),
    (6, "操作床人物融合", "treatment-bed-integration"),
    (7, "医美机构素人图", "clinic-candid-portrait"),
    (8, "日常手机自拍", "daily-selfie"),
    (9, "小红书日常形象照", "lifestyle-makeover"),
    (10, "面部皮肤状态参考", "skin-condition-transfer"),
    (11, "面部骨相结构参考", "facial-structure-transfer"),
    (12, "五官复刻", "facial-feature-transfer"),
    (13, "术后恢复期种草图", "recovery-lifestyle-photo"),
    (14, "侧面鼻形替换", "nose-replacement-side-view"),
    (15, "双眼皮愈合时间线", "eyelid-recovery-timeline"),
    (16, "正面鼻形替换", "nose-replacement-front-view"),
    (17, "身材增重效果", "body-weight-change"),
    (18, "单双眼皮手机对比图", "eyelid-comparison-phone"),
]

SCREENSHOT_ROLES = {
    "Screenshot_2026-09-21-13-20-01-021_com.tencent.mm.jpg": ("effect", 1),
    "Screenshot_2026-09-21-13-20-03-183_com.tencent.mm.jpg": ("input", 1),
    "Screenshot_2026-09-21-13-20-04-959_com.tencent.mm.jpg": ("input", 2),
}


# 计算文件内容校验值，供复制前后逐项核对。
def file_hash(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


# 从实际文件头确定图片格式，纠正源文件可能存在的错误扩展名。
def detect_image_format(file_path: Path) -> tuple[str, str]:
    with file_path.open("rb") as handle:
        header = handle.read(12)
    if header.startswith(b"\xff\xd8"):
        return ".jpg", "image/jpeg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png", "image/png"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return ".webp", "image/webp"
    raise ValueError(f"无法识别的图片内容：{file_path}")


# 从原始说明文档按 1 至 18 号提取模板说明，保留原文供后续核对。
def read_source_notes() -> dict[int, str]:
    content = (SOURCE / "test.md").read_text(encoding="utf-8-sig")
    matches = list(re.finditer(r"(?m)^(\d+)\.", content))
    notes: dict[int, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
        notes[int(match.group(1))] = content[match.start() : end].strip()
    if set(notes) != set(range(1, 19)):
        raise ValueError("test.md 未完整包含 1 至 18 号说明")
    return notes


# 按确定的文件名或已查看的截图标签分类友商原图和效果图。
def classify_competitor_file(number: int, file_path: Path) -> tuple[str, int, str]:
    if number == 14:
        if file_path.name not in SCREENSHOT_ROLES:
            raise ValueError(f"第14类有未识别的截图：{file_path}")
        kind, order = SCREENSHOT_ROLES[file_path.name]
        return kind, order, "screenshot"
    upload = re.fullmatch(r"上传图([1-4])\.(jpg|jpeg|png)", file_path.name, re.I)
    if upload:
        return "input", int(upload.group(1)), "image_file"
    effect = re.fullmatch(r"生成效果(?:图)?\.(jpg|jpeg|png)", file_path.name, re.I)
    if effect:
        return "effect", 1, "image_file"
    raise ValueError(f"未识别的友商文件：{file_path}")


# 保存 UTF-8 JSON，使索引和各模板档案便于人工查看与后续工具读取。
def write_json(file_path: Path, value: object) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# 先生成全部复制计划和档案，检查没有漏分、重名或越界后才写目标目录。
def prepare_import() -> tuple[list[dict], list[tuple[Path, Path, str]], list[dict]]:
    notes = read_source_notes()
    historical_report = json.loads(HISTORICAL_REPORT.read_text(encoding="utf-8"))
    if historical_report.get("executionId") != HISTORICAL_EXECUTION:
        raise ValueError("历史执行报告编号不符")
    historical_samples = {sample["sampleId"]: sample for sample in historical_report["samples"]}
    catalog: list[dict] = []
    plan: list[tuple[Path, Path, str]] = []
    manifests: list[dict] = []
    planned_sources: set[Path] = set()
    planned_destinations: set[Path] = set()

    # 把源路径及目标路径固定下来；源文件内容相同也不跨类别合并。
    def add_file(source: Path, destination: Path) -> dict:
        resolved_source = source.resolve(strict=True)
        resolved_destination = destination.resolve(strict=False)
        if not resolved_source.is_relative_to(SOURCE) or not resolved_destination.is_relative_to(TARGET):
            raise ValueError("素材路径超出预期根目录")
        if resolved_source in planned_sources or resolved_destination in planned_destinations:
            raise ValueError(f"重复的源文件或目标文件：{source}")
        actual_extension, content_type = detect_image_format(source)
        if destination.suffix.lower() != actual_extension:
            raise ValueError(f"目标扩展名与真实图片格式不符：{destination}")
        digest = file_hash(source)
        planned_sources.add(resolved_source)
        planned_destinations.add(resolved_destination)
        plan.append((source, destination, digest))
        return {
            "path": destination.relative_to(destination_dir).as_posix(),
            "sourceRelativePath": source.relative_to(SOURCE).as_posix(),
            "sizeBytes": source.stat().st_size,
            "sha256": digest,
            "contentType": content_type,
        }

    for number, name, slug in TEMPLATES:
        source_dir = SOURCE / f"test{number}"
        if not source_dir.is_dir() or source_dir.is_symlink():
            raise ValueError(f"源目录缺失或不是普通目录：{source_dir}")
        template_id = f"TPL{number:04d}"
        directory = f"{template_id}-{slug}"
        destination_dir = TARGET / directory
        friend_inputs: list[dict] = []
        friend_effects: list[dict] = []
        image_sets: list[dict] = []
        test_cases: list[dict] = []

        # 只有 test1 的两个 testexample 子目录属于测试素材；其余顶层图片都是友商参考。
        for source_file in sorted(source_dir.iterdir()):
            if source_file.is_dir():
                if number != 1 or source_file.name not in ("testexample1", "testexample2"):
                    raise ValueError(f"未识别的子目录：{source_file}")
                continue
            if not source_file.is_file() or source_file.is_symlink():
                raise ValueError(f"未识别的源条目：{source_file}")
            kind, order, representation = classify_competitor_file(number, source_file)
            actual_extension, _ = detect_image_format(source_file)
            suffix = "_capture" if representation == "screenshot" else ""
            if kind == "input":
                role = "_subject_image" if number == 1 and order == 1 else "_action_reference" if number == 1 and order == 2 else ""
                filename = f"input_{order:02d}{role}{suffix}{actual_extension}"
            else:
                filename = f"effect_{order:02d}{suffix}{actual_extension}"
            record = add_file(source_file, destination_dir / "competitor" / filename)
            record["order"] = order
            record["representation"] = representation
            if kind == "input":
                record["slotKey"] = "subject_image" if number == 1 and order == 1 else "action_reference" if number == 1 and order == 2 else None
                friend_inputs.append(record)
            else:
                friend_effects.append(record)

        friend_inputs.sort(key=lambda item: item["order"])
        friend_effects.sort(key=lambda item: item["order"])
        if len({item["order"] for item in friend_inputs}) != len(friend_inputs):
            raise ValueError(f"友商上传图序号重复：{source_dir}")
        if len({item["order"] for item in friend_effects}) != len(friend_effects):
            raise ValueError(f"友商效果图序号重复：{source_dir}")

        if number == 1:
            historical_ids = {1: "testexample2", 2: "testexample3"}
            for sample_number in (1, 2):
                sample_dir = source_dir / f"testexample{sample_number}"
                sample_inputs: list[dict] = []
                for source_file in sorted(sample_dir.iterdir()):
                    if not source_file.is_file() or source_file.is_symlink():
                        raise ValueError(f"测试素材内有非普通文件：{source_file}")
                    upload = re.fullmatch(r"uploadpic([1-4])\.(jpg|jpeg|png)", source_file.name, re.I)
                    if not upload:
                        raise ValueError(f"未识别的测试图片：{source_file}")
                    order = int(upload.group(1))
                    slot_key = "subject_image" if order == 1 else "action_reference" if order == 2 else None
                    if slot_key is None:
                        raise ValueError(f"动作模仿测试图超过已核对栏位：{source_file}")
                    actual_extension, _ = detect_image_format(source_file)
                    destination = destination_dir / "test-inputs" / f"S{sample_number:03d}" / f"input_{order:02d}_{slot_key}{actual_extension}"
                    record = add_file(source_file, destination)
                    record.update({"order": order, "slotKey": slot_key})
                    sample_inputs.append(record)
                sample_inputs.sort(key=lambda item: item["order"])
                if [item["order"] for item in sample_inputs] != [1, 2]:
                    raise ValueError(f"测试图不是完整的两栏输入：{sample_dir}")
                historical = historical_samples[historical_ids[sample_number]]["inputs"]
                if [item["sha256"].lower() for item in sample_inputs] != [item["sha256"].lower() for item in historical]:
                    raise ValueError(f"当前图片与历史执行报告不一致：{sample_dir}")
                image_sets.append({
                    "id": f"S{sample_number:03d}",
                    "sourceDirectory": sample_dir.relative_to(SOURCE).as_posix(),
                    "inputs": sample_inputs,
                    "tags": [],
                })
                test_cases.append({
                    "id": f"T{sample_number:03d}",
                    "imageSetId": f"S{sample_number:03d}",
                    "pool": "development",
                    "supplementalDescription": SUPPLEMENTAL_DESCRIPTION,
                    "focus": "动作模仿及手持冰袋",
                    "historicalTrial": {
                        "executionId": HISTORICAL_EXECUTION,
                        "sampleId": historical_ids[sample_number],
                        "matchBasis": "当前两张图片的 SHA-256 与历史报告一致",
                    },
                })

        competitor = None
        if friend_inputs or friend_effects:
            competitor = {
                "sourceType": "competitor",
                "inputs": friend_inputs,
                "effects": friend_effects,
                "missingNote": None,
            }
        observed_orders = [item["order"] for item in friend_inputs]
        slots = [
            {
                "order": order,
                "slotKey": "subject_image" if number == 1 and order == 1 else "action_reference" if number == 1 and order == 2 else None,
                "label": "主体人物" if number == 1 and order == 1 else "动作参考" if number == 1 and order == 2 else f"上传图{order}（待核对）",
            }
            for order in observed_orders
        ]
        manifest = {
            "schemaVersion": 1,
            "templateTypeId": template_id,
            "name": name,
            "revision": 1,
            "sourceDirectory": source_dir.relative_to(SOURCE).as_posix(),
            "sourceNote": notes[number],
            "slotMappingStatus": "verified_from_trial_report" if number == 1 else "unverified",
            "slots": slots,
            "competitorReference": competitor,
            "imageSets": image_sets,
            "testCases": test_cases,
        }
        manifests.append({"directory": destination_dir, "manifest": manifest})
        catalog.append({
            "templateTypeId": template_id,
            "name": name,
            "directory": directory,
            "sourceDirectory": source_dir.relative_to(SOURCE).as_posix(),
        })

    # 核对 D:\pic 的所有文件都已有明确去向，避免遗漏隐藏或额外文件。
    actual_sources = {file.resolve(strict=True) for file in SOURCE.rglob("*") if file.is_file()}
    expected_sources = planned_sources | {(SOURCE / "test.md").resolve(strict=True)}
    if actual_sources != expected_sources:
        missing = sorted(str(file) for file in actual_sources - expected_sources)
        unexpected = sorted(str(file) for file in expected_sources - actual_sources)
        raise ValueError(f"源文件盘点不一致；未分类={missing}，不存在={unexpected}")
    return catalog, plan, manifests


# 复制并重新计算校验值；验证通过后才写索引和迁移清单。
def main() -> None:
    if not SOURCE.is_dir() or not BASE.is_dir() or TARGET.exists():
        raise ValueError("源目录或目标父目录不存在，或目标素材目录已存在")
    if SOURCE.is_symlink() or BASE.is_symlink():
        raise ValueError("源目录或目标父目录不能是符号链接")
    catalog, plan, manifests = prepare_import()
    TARGET.mkdir()
    migration_files: list[dict] = []
    for source, destination, expected_hash in plan:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        actual_hash = file_hash(destination)
        if actual_hash != expected_hash:
            raise ValueError(f"复制后内容不一致：{source} -> {destination}")
        migration_files.append({
            "source": source.relative_to(SOURCE).as_posix(),
            "destination": destination.relative_to(BASE).as_posix(),
            "sha256": actual_hash,
            "sizeBytes": destination.stat().st_size,
        })
    for item in manifests:
        write_json(item["directory"] / "manifest.json", item["manifest"])
    write_json(TARGET / "catalog.json", {"schemaVersion": 1, "templates": catalog})
    source_note_destination = BASE / "source-notes" / "test.md"
    source_note_destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE / "test.md", source_note_destination)
    if file_hash(source_note_destination) != file_hash(SOURCE / "test.md"):
        raise ValueError("原始说明文档复制后内容不一致")
    write_json(BASE / "migration-map.json", {
        "schemaVersion": 1,
        "importedAt": datetime.now(timezone.utc).isoformat(),
        "sourceRoot": str(SOURCE),
        "destinationRoot": str(TARGET),
        "sourceFilesPreserved": True,
        "imageFileCount": len(migration_files),
        "files": migration_files,
        "sourceNote": {
            "source": "test.md",
            "destination": "source-notes/test.md",
            "sha256": file_hash(source_note_destination),
        },
    })
    print(f"已复制并核对 {len(migration_files)} 张图片，建立 {len(manifests)} 个模板档案。")


if __name__ == "__main__":
    main()
