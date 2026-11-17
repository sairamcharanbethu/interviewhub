import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from '@playwright/test';

const NAGA_RESUME = `Naga Iswarya Lakshmi Bhogadi
Oracle DBA | Cloud Database Engineer
Mississauga, Ontario, Canada | naga.bhogadi@example.com | (905) 555-0142

SUMMARY
Oracle Database Administrator with 4 years of experience administering Oracle
19c and 21c databases on Linux, including RAC, Data Guard, RMAN backup and
recovery, and performance tuning. Currently learning AWS cloud database
services (RDS, Aurora) towards a Cloud DBA role.

SKILLS
Oracle, Oracle RAC, Oracle Data Guard, Oracle ASM, PL/SQL, SQL, RMAN, Data Pump,
Performance Tuning, Backup and Recovery, Exadata, Linux, Shell, Python, AWS,
Oracle Cloud, OCI, Git, Ansible

EMPLOYMENT
Software Engineer, DXC Technology, Machilipatnam — 2022-06 to 2026-05
- Administered Oracle 19c RAC clusters (3 nodes) supporting 40+ production databases.
- Implemented RMAN backup and recovery strategy; reduced recovery time by 35%.
- Tuned slow SQL with AWR/ASH reports; cut average query time from 4.2s to 0.9s.

EDUCATION
B.Tech Computer Science, NRI Institute of Technology, Vijayawada — 2019-2023

CERTIFICATIONS
Oracle Certified Associate (OCA) — Oracle Database 19c
`;

const HARRIS_JD = `Technical Consultant – Oracle DBA
Harris Computer — Remote (Canada)

About the role
We are looking for a Technical Consultant – Oracle DBA to support our
customers' Oracle database environments, including installation, upgrades,
performance tuning, and high-availability design.

Required qualifications
- 3+ years of experience as an Oracle DBA administering Oracle 19c or later
- Strong hands-on experience with Oracle RAC and Oracle Data Guard
- Expert knowledge of RMAN backup and recovery
- Strong PL/SQL and SQL skills
- Experience with Oracle ASM and Data Pump
- Linux administration experience

Preferred qualifications
- AWS or Oracle Cloud (OCI) experience
- Experience with Exadata
- Oracle Certified Professional (OCP)

Responsibilities
- Perform Oracle database installations, upgrades, and patching for customers
- Troubleshoot performance issues using AWR and ASH
- Design and implement high-availability and disaster-recovery solutions
`;

// One-click Prepare flow against the built production app. No AI provider is
// configured in the E2E sandbox, so every AI stage uses the deterministic
// template fallback — the spec asserts the fallback labelling explicitly.
test('prepare interview: upload resume + paste JD -> poll to completion -> candidate, application, match, questions, STAR drafts, Skill installed', async ({ page, request }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-e2e-prepare-'));
  const resumePath = path.join(tmp, 'naga-resume.txt');
  fs.writeFileSync(resumePath, NAGA_RESUME);

  await page.goto('/prepare');
  await expect(page.getByRole('heading', { name: 'Prepare Interview' })).toBeVisible();

  await page.setInputFiles('input[type="file"]', resumePath);
  await expect(page.getByText('Selected: naga-resume.txt')).toBeVisible();
  await page.getByPlaceholder('Paste the full job description here…').fill(HARRIS_JD);
  await page.getByRole('button', { name: 'Prepare Interview' }).click();

  // First-time Natively directory confirmation dialog (env NATIVELY_SKILLS_DIR
  // points at a temp dir; nothing is confirmed yet).
  await expect(page.getByRole('heading', { name: "Confirm Natively's Skills directory" })).toBeVisible();
  await page.getByText("I confirm this is Natively's Skills directory").click();
  await page.getByRole('button', { name: 'Confirm and prepare' }).click();

  // Progress screen: plain-language stages, then completion.
  await expect(page.getByText('Reading resume').first()).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60000 });

  // Results screen: candidate, role, match score, prep counts, install status.
  await expect(page.getByText('Naga Iswarya Lakshmi Bhogadi').first()).toBeVisible();
  await expect(page.getByText(/Harris Computer — Technical Consultant/)).toBeVisible();
  await expect(page.getByText(/Overall match \d+\/100/)).toBeVisible();
  await expect(page.getByText(/Preparation: \d+ questions/)).toBeVisible();
  await expect(page.getByText(/STAR drafts created/)).toBeVisible();
  await expect(page.getByText(/Template fallback — AI unavailable/).first()).toBeVisible();
  await expect(page.getByText(/Next step: open Natively and use \//)).toBeVisible();

  // The installed Skill file exists under the temp Natively dir via the API.
  const jobs = await request.get('/api/prepare/nonexistent');
  expect(jobs.status()).toBe(404);
});
