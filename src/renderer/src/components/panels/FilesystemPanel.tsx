import { useState, useEffect } from 'react'
import { Folder, File, ChevronRight, ChevronDown, FolderOpen, Download, Loader2, Check, FolderSync } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import type { FileInfo } from '@/types'

export function FilesystemPanel() {
  const { workspaceFiles, workspacePath, currentThreadId, setWorkspacePath, setWorkspaceFiles } = useAppStore()
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [syncSuccess, setSyncSuccess] = useState(false)
  
  // Load workspace path for current thread
  useEffect(() => {
    async function loadWorkspacePath() {
      if (currentThreadId) {
        const path = await window.api.workspace.get(currentThreadId)
        setWorkspacePath(path)
      }
    }
    loadWorkspacePath()
  }, [currentThreadId, setWorkspacePath])
  
  // Auto-expand root when workspace path changes
  useEffect(() => {
    if (workspacePath) {
      setExpandedDirs(new Set([workspacePath]))
    }
  }, [workspacePath])
  
  // Listen for file changes from the main process
  useEffect(() => {
    const cleanup = window.api.workspace.onFilesChanged(async (data) => {
      // Only refresh if this is the current thread
      if (data.threadId === currentThreadId) {
        console.log('[FilesystemPanel] Files changed, refreshing...')
        try {
          const result = await window.api.workspace.loadFromDisk(data.threadId)
          if (result.success) {
            setWorkspaceFiles(result.files)
          }
        } catch (e) {
          console.error('[FilesystemPanel] Error refreshing files:', e)
        }
      }
    })
    
    return cleanup
  }, [currentThreadId, setWorkspaceFiles])
  
  // Handle selecting a workspace folder
  async function handleSelectFolder() {
    if (!currentThreadId) return
    
    setSyncing(true)
    try {
      const path = await window.api.workspace.select(currentThreadId)
      if (path) {
        setWorkspacePath(path)
      }
    } catch (e) {
      console.error('[FilesystemPanel] Select folder error:', e)
    } finally {
      setSyncing(false)
    }
  }
  
  // Handle sync to disk
  async function handleSyncToDisk() {
    if (!currentThreadId) return
    
    // If no files, just select a folder
    if (workspaceFiles.length === 0) {
      await handleSelectFolder()
      return
    }
    
    setSyncing(true)
    setSyncSuccess(false)
    
    try {
      const result = await window.api.workspace.syncToDisk(currentThreadId)
      
      if (result.success) {
        setSyncSuccess(true)
        if (result.targetPath) {
          setWorkspacePath(result.targetPath)
        }
        // Reset success indicator after 2 seconds
        setTimeout(() => setSyncSuccess(false), 2000)
        
        console.log('[FilesystemPanel] Synced files:', result.synced)
        if (result.errors?.length) {
          console.warn('[FilesystemPanel] Sync errors:', result.errors)
        }
      } else {
        console.error('[FilesystemPanel] Sync failed:', result.error)
      }
    } catch (e) {
      console.error('[FilesystemPanel] Sync error:', e)
    } finally {
      setSyncing(false)
    }
  }

  // Normalize path to always start with /
  const normalizePath = (p: string) => p.startsWith('/') ? p : '/' + p

  // Get parent path, always returns / for root-level items
  const getParentPath = (p: string) => {
    const normalized = normalizePath(p)
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) return '/'
    return normalized.substring(0, lastSlash)
  }

  // Build tree structure with proper path normalization
  const buildTree = (files: FileInfo[]) => {
    const tree: Map<string, FileInfo[]> = new Map()
    const allDirs = new Set<string>()
    
    // First pass: collect all directories (both explicit and implicit)
    files.forEach(file => {
      const normalized = normalizePath(file.path)
      
      // Walk up the path to collect all parent directories
      let current = getParentPath(normalized)
      while (current !== '/') {
        allDirs.add(current)
        current = getParentPath(current)
      }
      
      // If this is an explicit directory entry, add it
      if (file.is_dir) {
        const dirPath = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
        allDirs.add(dirPath)
      }
    })
    
    // Second pass: add files and directories to their parent's children list
    files.forEach(file => {
      const normalized = normalizePath(file.path.endsWith('/') ? file.path.slice(0, -1) : file.path)
      const parentPath = getParentPath(normalized)
      
      if (!tree.has(parentPath)) {
        tree.set(parentPath, [])
      }
      
      // Use normalized path in the file info for consistent tree lookups
      tree.get(parentPath)!.push({
        ...file,
        path: normalized
      })
    })
    
    // Third pass: add implicit directories as entries
    allDirs.forEach(dir => {
      const parentPath = getParentPath(dir)
      
      // Check if this directory is already in parent's children
      const siblings = tree.get(parentPath) || []
      if (!siblings.some(f => f.path === dir)) {
        if (!tree.has(parentPath)) {
          tree.set(parentPath, [])
        }
        tree.get(parentPath)!.push({
          path: dir,
          is_dir: true
        })
      }
    })
    
    // Sort children: directories first, then alphabetically
    tree.forEach((children) => {
      children.sort((a, b) => {
        if (a.is_dir && !b.is_dir) return -1
        if (!a.is_dir && b.is_dir) return 1
        return a.path.localeCompare(b.path)
      })
    })
    
    return tree
  }

  const tree = buildTree(workspaceFiles)

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const renderNode = (file: FileInfo, depth: number = 0) => {
    const name = file.path.split('/').pop() || file.path
    const isExpanded = expandedDirs.has(file.path)
    const children = tree.get(file.path) || []

    return (
      <div key={file.path}>
        <button
          onClick={() => file.is_dir && toggleDir(file.path)}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-background-interactive transition-colors",
          )}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          {file.is_dir ? (
            <>
              {isExpanded ? (
                <ChevronDown className="size-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 text-muted-foreground" />
              )}
              <Folder className="size-4 text-status-warning" />
            </>
          ) : (
            <>
              <span className="w-3" />
              <File className="size-4 text-muted-foreground" />
            </>
          )}
          <span className="flex-1 text-left truncate">{name}</span>
          {!file.is_dir && file.size && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatSize(file.size)}
            </span>
          )}
        </button>
        
        {file.is_dir && isExpanded && children.map(child => renderNode(child, depth + 1))}
      </div>
    )
  }

  // Get root level items (all paths are normalized to start with /)
  const rootItems = tree.get('/') || []

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <span className="text-section-header">WORKSPACE</span>
          <div className="flex items-center gap-2">
            {workspacePath && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[80px]" title={workspacePath}>
                {workspacePath.split('/').pop()}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={workspaceFiles.length > 0 ? handleSyncToDisk : handleSelectFolder}
              disabled={syncing || !currentThreadId}
              className="h-6 px-2 text-xs"
              title={
                workspaceFiles.length > 0 
                  ? (workspacePath ? `Sync to ${workspacePath}` : 'Sync files to disk')
                  : (workspacePath ? `Linked to ${workspacePath}` : 'Set sync folder')
              }
            >
              {syncing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : syncSuccess ? (
                <Check className="size-3 text-status-nominal" />
              ) : workspaceFiles.length > 0 ? (
                <Download className="size-3" />
              ) : (
                <FolderSync className="size-3" />
              )}
              <span className="ml-1">
                {workspaceFiles.length > 0 ? 'Sync' : (workspacePath ? 'Change' : 'Link')}
              </span>
            </Button>
          </div>
        </div>
      </div>
      
      <ScrollArea className="flex-1 min-h-0">
        <div className="py-2">
          {rootItems.length === 0 ? (
            <div className="flex flex-col items-center text-center text-sm text-muted-foreground py-8 px-4">
              <FolderOpen className="size-8 mb-2 opacity-50" />
              <span>No workspace files</span>
              <span className="text-xs mt-1">
                {workspacePath 
                  ? `Linked to ${workspacePath.split('/').pop()}`
                  : 'Click "Link" to set a sync folder'}
              </span>
              <span className="text-xs mt-1 opacity-75">
                Files will appear when the agent creates them
              </span>
            </div>
          ) : (
            rootItems.map(file => renderNode(file))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
