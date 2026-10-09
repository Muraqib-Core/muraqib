export interface PackageGroup {
  groupName: string;
  packages: string[];
}
export const MURAQIB_LOCAL_PRESETS: PackageGroup[] = [
  {
    groupName: 'react-core-suite',
    packages: [
      'react', 
      'react-dom', 
      'react-server-dom-webpack', 
      '@types/react', 
      '@types/react-dom'
    ]
  },
  {
    groupName: 'tailwindcss-v4-stack',
    packages: [
      'tailwindcss', 
      '@tailwindcss/vite', 
      '@tailwindcss/postcss', 
      '@tailwindcss/upgrade'
    ]
  },
  {
    groupName: 'prisma-orm-ecosystem',
    packages: [
      'prisma', 
      '@client/prisma', 
      '@prisma/client'
    ]
  },
  {
    groupName: 'testing-library-react',
    packages: [
      '@testing-library/react',
      '@testing-library/dom',
      '@testing-library/user-event'
    ]
  }
];

export async function fetchRemoteMuraqibPresets(url: string): Promise<PackageGroup[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`⚠️  [Muraqib Remote Engine]: Failed to fetch presets from server (Status: ${response.status}). Falling back to local configuration.`);
      return MURAQIB_LOCAL_PRESETS;
    }
    const remoteData = await response.json();
    if (Array.isArray(remoteData)) {  
      return remoteData as PackageGroup[];
    }
    return MURAQIB_LOCAL_PRESETS;
  } 
  
// muraqib-unreachable: flagged by automated triage. Review before removal.
  catch (_error) {
    console.warn('⚠️  [Muraqib Remote Engine]: Network connection error while syncing remote presets. Local core active.');
    return MURAQIB_LOCAL_PRESETS;
  }
}