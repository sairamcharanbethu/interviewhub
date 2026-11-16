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

// Full happy-path flow against the built production app. No AI provider is
// configured in the E2E sandbox, so prep questions use the offline template
// fallback — the spec asserts that explicitly.
test('candidate -> resume -> application -> JD -> match -> questions -> skill -> delete app, resume remains -> archive/restore candidate', async ({ page, request }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-e2e-resume-'));
  const resumePath = path.join(tmp, 'naga-resume.txt');
  fs.writeFileSync(resumePath, NAGA_RESUME);
  let candidateId = '';

  // 1. Create candidate.
  await page.goto('/candidates');
  await page.getByRole('button', { name: '+ New candidate' }).first().click();
  await page.getByLabel('Full name').fill('Naga Iswarya Lakshmi Bhogadi');
  await page.getByLabel('Location').fill('Mississauga');
  await page.getByRole('button', { name: 'Create candidate' }).click();
  await expect(page.getByRole('link', { name: /Naga Iswarya Lakshmi Bhogadi/ }).first()).toBeVisible();

  // 2. Upload txt resume on the candidate detail page.
  await page.getByRole('link', { name: /Naga Iswarya Lakshmi Bhogadi/ }).first().click();
  await expect(page).toHaveURL(/\/candidates\//);
  candidateId = page.url().split('/candidates/')[1].split(/[?#]/)[0];
  await page.setInputFiles('input[type="file"]', resumePath);
  await expect(page.getByText('Resume versions (1)')).toBeVisible();
  await expect(page.getByText('naga-resume.txt')).toBeVisible();

  // 3. Create application.
  await page.goto('/applications');
  await page.getByRole('button', { name: '+ New application' }).first().click();
  // Note: labels wrap their controls, so a select's accessible name includes
  // its option text ("Candidate *Select candidate…"). Anchored regexes match
  // the label prefix without depending on the option list.
  await page.getByRole('dialog').getByLabel(/^Candidate \*/).selectOption({ label: 'Naga Iswarya Lakshmi Bhogadi' });
  await page.getByRole('dialog').getByLabel(/^Company \*/).fill('Harris Computer');
  await page.getByRole('dialog').getByLabel(/^Role title \*/).fill('Technical Consultant – Oracle DBA');
  await page.getByRole('button', { name: 'Create application' }).click();
  await expect(page.getByRole('link', { name: /Harris Computer — Technical Consultant/ }).first()).toBeVisible();

  // 4. Paste JD, run match, generate questions, export skill — on the detail page.
  await page.getByRole('link', { name: /Harris Computer — Technical Consultant/ }).first().click();
  await expect(page).toHaveURL(/\/applications\//);
  const applicationId = page.url().split('/applications/')[1].split(/[?#]/)[0];
  await page.getByPlaceholder('Paste the full job description here…').fill(HARRIS_JD);
  await page.getByRole('button', { name: 'Save JD text' }).click();
  await expect(page.getByText('Oracle RAC', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Run Match' }).click();
  await expect(page.getByText('Overall match')).toBeVisible();
  const scoreText = await page.getByRole('progressbar', { name: 'Overall match' }).getAttribute('aria-valuenow');
  expect(Number(scoreText)).toBeGreaterThanOrEqual(50);

  await page.getByRole('button', { name: 'Generate questions' }).click();
  await expect(page.getByText('Tell me about yourself').first()).toBeVisible();

  await page.getByRole('button', { name: 'Generate SKILL.md' }).click();
  await expect(page.getByText(/Skill generated:/).first()).toBeVisible();

  // Verify the SKILL.md file on disk via the status API (same machine).
  const status = await request.get(`/api/natively/status?application_id=${applicationId}`);
  expect(status.ok()).toBe(true);
  const syncs = (await status.json()).syncs as Array<{ skill_path: string; skill_name: string }>;
  expect(syncs.length).toBeGreaterThan(0);
  const skillPath = syncs[0].skill_path;
  expect(fs.existsSync(skillPath)).toBe(true);
  const skill = fs.readFileSync(skillPath, 'utf8');
  expect(skill).toContain('Naga Iswarya Lakshmi Bhogadi');
  expect(skill).toContain('Harris Computer');
  expect(skill).toContain('Technical Consultant – Oracle DBA');
  expect(skill).toContain('DXC Technology');

  // 5. Delete the application; the resume must remain.
  // Cards are `rounded-xl` divs; scope actions to the card that holds the link.
  const cardFor = (name: RegExp) => page.getByRole('link', { name }).locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');
  await page.goto('/applications');
  await cardFor(/Harris Computer — Technical Consultant/).getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('link', { name: /Harris Computer — Technical Consultant/ })).toHaveCount(0);
  await page.goto(`/candidates/${candidateId}`);
  await expect(page.getByText('Resume versions (1)')).toBeVisible();
  await expect(page.getByText('naga-resume.txt')).toBeVisible();

  // 6. Archive and restore the candidate.
  await page.goto('/candidates');
  await cardFor(/Naga Iswarya Lakshmi Bhogadi/).getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('link', { name: /Naga Iswarya Lakshmi Bhogadi/ })).toHaveCount(0);
  await page.getByLabel('Show archived').check();
  await expect(page.getByRole('link', { name: /Naga Iswarya Lakshmi Bhogadi/ }).first()).toBeVisible();
  await cardFor(/Naga Iswarya Lakshmi Bhogadi/).getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('link', { name: /Naga Iswarya Lakshmi Bhogadi/ }).first()).toBeVisible();

  // Cleanup: permanently delete the candidate via the API so no E2E data remains.
  const del = await request.delete(`/api/candidates/${candidateId}?permanent=true`);
  expect(del.ok()).toBe(true);
  fs.rmSync(tmp, { recursive: true, force: true });
});
