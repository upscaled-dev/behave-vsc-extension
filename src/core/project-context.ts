import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { ExtensionConfig } from "./extension-config";
import { FrameworkFactory } from "./framework-factory";
import { CommandBuilder } from "./command-builders/command-builder-interface";

export interface ProjectContext {
  readonly folder: vscode.WorkspaceFolder;
  readonly config: ExtensionConfig;
  readonly cwd: string;
  readonly builder: CommandBuilder;
}

/** A file belongs to exactly one folder; the operation keeps the resulting snapshot. */
export async function resolveProjectContexts(files?: readonly string[], workspace = vscode.workspace): Promise<Map<string, ProjectContext>> {
  const folders = workspace.workspaceFolders ?? [];
  if (!folders.length) {throw new Error("Open a workspace folder before running or debugging tests.");}
  const selected = files ? files.map((file) => {
    const folder = workspace.getWorkspaceFolder(vscode.Uri.file(file));
    if (!folder) {throw new Error(`Open the folder containing '${file}' in this workspace before running or debugging it.`);}
    return folder;
  }) : folders;
  const projects = new Map<string, ProjectContext>();
  // Snapshot every selected resource before asynchronous framework detection begins.
  for (const folder of selected) {
    const key = folder.uri.toString();
    if (projects.has(key)) {continue;}
    const config = ExtensionConfig.forResource(folder.uri);
    const cwd = path.resolve(folder.uri.fsPath, config.workingDirectory || ".");
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new Error(`Working directory '${cwd}' for project '${folder.name}' does not exist. Update behaveTestRunner.workingDirectory.`);
    }
    projects.set(key, { folder, config, cwd, builder: FrameworkFactory.createCommandBuilder(config.getFramework(), config) });
  }
  for (const [key, project] of projects) {
    const config = project.config;
    const framework = !config.hasExplicitFramework() && config.isFrameworkAutoDetectionEnabled()
      ? await FrameworkFactory.autoDetect(project.cwd) : config.getFramework();
    projects.set(key, { ...project, builder: FrameworkFactory.createCommandBuilder(framework, config) });
  }
  return projects;
}

export function projectForFile(projects: ReadonlyMap<string, ProjectContext>, file: string): ProjectContext {
  const uri = vscode.Uri.file(file);
  const project = Array.from(projects.values()).filter(({ folder }) => {
    const relative = path.relative(folder.uri.fsPath, uri.fsPath);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }).sort((a, b) => b.folder.uri.fsPath.length - a.folder.uri.fsPath.length)[0];
  if (!project) {throw new Error(`No admitted project contains '${file}'. Refresh tests and try again.`);}
  return project;
}
