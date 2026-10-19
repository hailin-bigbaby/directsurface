import { BrowserApplicationFiles, type ApplicationFilePort } from './application_files'
const browserFiles = new BrowserApplicationFiles()
export function applicationFiles(): ApplicationFilePort { return browserFiles }
