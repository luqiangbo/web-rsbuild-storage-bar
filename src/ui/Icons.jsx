import React from "react";
import {
  AlertCircle,
  AlignLeft,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  File,
  FileText,
  Film,
  Folder,
  FolderOpen,
  GitCompareArrows,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  LayoutGrid,
  List,
  Lock,
  LockOpen,
  Minimize2,
  Music,
  Package,
  Pin,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Table2,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

function makeIcon(Component, defaultSize = 14, defaultStroke = 1.75) {
  return function AppIcon({ className, size = defaultSize, strokeWidth = defaultStroke, ...props }) {
    return (
      <span role="img" className={className ? `anticon app-icon ${className}` : "anticon app-icon"} {...props}>
        <Component size={size} strokeWidth={strokeWidth} aria-hidden="true" />
      </span>
    );
  };
}

export const IconDatabase = makeIcon(Database);
export const IconMedia = makeIcon(Film);
export const IconLock = makeIcon(Lock, 13.5);
export const IconUnlock = makeIcon(LockOpen, 13.5);
export const IconRefresh = makeIcon(RefreshCw, 13.5);
export const IconExternal = makeIcon(ExternalLink, 13.5);
export const IconSettings = makeIcon(Settings, 14);
export const IconDelete = makeIcon(Trash2, 13.5);
export const IconAlert = makeIcon(AlertCircle, 16, 2);
export const IconPlus = makeIcon(Plus, 15, 1.9);
export const IconImport = makeIcon(ArrowDownToLine, 14);
export const IconExport = makeIcon(ArrowUpFromLine, 14);
export const IconDownload = makeIcon(Download, 14);
export const IconDiff = makeIcon(GitCompareArrows, 14);
export const IconUndo = makeIcon(Undo2, 14);
export const IconRevert = makeIcon(RotateCcw, 13.5);
export const IconCopy = makeIcon(Copy, 13.5);
export const IconKey = makeIcon(KeyRound, 13.5);
export const IconPin = makeIcon(Pin, 13.5);
export const IconSearch = makeIcon(Search, 13.5);
export const IconPrev = makeIcon(ChevronLeft, 14.5);
export const IconNext = makeIcon(ChevronRight, 14.5);
export const IconArrowLeft = makeIcon(ArrowLeft, 14);
export function IconTreeChevron({ className, size = 10, ...props }) {
  return (
    <span role="img" className={className ? `anticon app-icon ${className}` : "anticon app-icon"} {...props}>
      <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <path d="M4.2 2.4a.75.75 0 0 1 1.22-.59l4.2 3.35a.75.75 0 0 1 0 1.18l-4.2 3.35A.75.75 0 0 1 4.2 9.1V2.4Z" />
      </svg>
    </span>
  );
}
export const IconTable = makeIcon(Table2, 13.5);
export const IconCache = makeIcon(HardDrive, 13.5);
export const IconBucket = makeIcon(Package, 13.5);
export const IconFormat = makeIcon(AlignLeft, 14);
export const IconMinify = makeIcon(Minimize2, 13.5);
export const IconGrid = makeIcon(LayoutGrid, 14);
export const IconList = makeIcon(List, 14);
export const IconFolder = makeIcon(Folder, 14);
export const IconFolderOpen = makeIcon(FolderOpen, 14);
export const IconFile = makeIcon(File, 14);
export const IconFileText = makeIcon(FileText, 14);
export const IconImage = makeIcon(ImageIcon, 14);
export const IconAudio = makeIcon(Music, 14);
export const IconVideo = makeIcon(Film, 14);
export const IconPlay = makeIcon(Play, 13.5);
export const IconClose = makeIcon(X, 14);
export const IconZoomIn = makeIcon(ZoomIn, 14);
export const IconZoomOut = makeIcon(ZoomOut, 14);
