import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { MasterDB } from "./types";

const DB_PATH = join(__dirname, "..", "..", "data_inventory.json");

interface Issue {
    path: string;
    message: string;
}

function ok(
    condition: boolean,
    path: string,
    message: string,
    issues: Issue[],
): void {
    if (!condition) issues.push({ path, message });
}

function validDate(date: string): boolean {
    if (!date) return false;
    return (
        /^\w+ \d{4}$/.test(date) ||
        /^\d{4}-\d{2}(-\d{2})?$/.test(date) ||
        date === "Present"
    );
}

function main(): void {
    if (!existsSync(DB_PATH)) {
        console.error(`data_inventory.json not found at ${DB_PATH}`);
        process.exit(1);
    }

    let db: MasterDB;
    try {
        db = JSON.parse(readFileSync(DB_PATH, "utf-8").trim()) as MasterDB;
    } catch (e) {
        console.error("JSON parse error:", (e as Error).message);
        process.exit(1);
    }

    const issues: Issue[] = [];

    const p = db.personal_info;
    ok(!!p?.name, "personal_info.name", "missing", issues);
    ok(!!p?.email, "personal_info.email", "missing", issues);
    ok(!!p?.phone, "personal_info.phone", "missing", issues);
    ok(!!p?.location, "personal_info.location", "missing", issues);
    ok(Array.isArray(p?.links), "personal_info.links", "must be array", issues);

    ok(
        db.education?.length > 0,
        "education",
        "empty — add at least one degree",
        issues,
    );
    db.education?.forEach((edu, i) => {
        ok(!!edu.institution, `education[${i}].institution`, "missing", issues);
        ok(!!edu.degree_type, `education[${i}].degree_type`, "missing", issues);
        ok(!!edu.major, `education[${i}].major`, "missing", issues);
        ok(
            validDate(edu.startDate),
            `education[${i}].startDate`,
            `invalid format "${edu.startDate}"`,
            issues,
        );
        ok(
            validDate(edu.endDate),
            `education[${i}].endDate`,
            `invalid format "${edu.endDate}"`,
            issues,
        );
    });

    ok(
        db.experience?.length > 0,
        "experience",
        "empty — add at least one role",
        issues,
    );
    db.experience?.forEach((exp, i) => {
        ok(!!exp.company, `experience[${i}].company`, "missing", issues);
        ok(!!exp.role, `experience[${i}].role`, "missing", issues);
        ok(
            exp.technologies_used?.length > 0,
            `experience[${i}].technologies_used`,
            "empty — agents need this to verify bullet tech claims",
            issues,
        );
        ok(
            exp.raw_achievements?.length > 0,
            `experience[${i}].raw_achievements`,
            "empty — agents use this as source of truth for bullets",
            issues,
        );
        ok(
            validDate(exp.startDate),
            `experience[${i}].startDate`,
            `invalid format "${exp.startDate}"`,
            issues,
        );
    });

    db.projects?.forEach((proj, i) => {
        ok(!!proj.name, `projects[${i}].name`, "missing", issues);
        ok(
            proj.technologies_used?.length > 0,
            `projects[${i}].technologies_used`,
            "empty — agents need this",
            issues,
        );
        ok(
            proj.raw_achievements?.length > 0,
            `projects[${i}].raw_achievements`,
            "empty — agents use this for bullet content",
            issues,
        );
    });

    ok(
        db.skills?.programming_languages?.length > 0,
        "skills.programming_languages",
        "empty",
        issues,
    );

    if (issues.length === 0) {
        console.log(
            `✓ data_inventory.json valid — ${db.experience.length} role(s), ` +
                `${db.projects.length} project(s), ${db.education.length} degree(s)`,
        );
    } else {
        console.log(`✗ ${issues.length} issue(s) found:\n`);
        issues.forEach((issue) =>
            console.log(`  [${issue.path}] ${issue.message}`),
        );
        process.exit(1);
    }
}

main();
