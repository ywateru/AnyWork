/// <reference types="vite/client" />
interface Window {
  RemoteAgentAndroid?: { saveFile(name: string, content: string): void };
}
