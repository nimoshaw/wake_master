package com.wakemaster.app

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Job

// === Color Palette (matching desktop dark theme) ===
private val BgPrimary = Color(0xFF0A0E1A)
private val BgSecondary = Color(0xFF111827)
private val BgCard = Color(0xCC111827)
private val TextPrimary = Color(0xFFF1F5F9)
private val TextSecondary = Color(0xFF94A3B8)
private val TextMuted = Color(0xFF64748B)
private val Accent = Color(0xFF6366F1)
private val AccentHover = Color(0xFF818CF8)
private val Green = Color(0xFF22C55E)
private val GreenBg = Color(0x1422C55E)
private val Red = Color(0xFFEF4444)
private val Orange = Color(0xFFF59E0B)
private val OrangeBg = Color(0x14F59E0B)
private val GrayBg = Color(0x1A475569)

private val DarkColorScheme = darkColorScheme(
    primary = Accent,
    secondary = AccentHover,
    background = BgPrimary,
    surface = BgSecondary,
    onPrimary = Color.White,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WakeMasterApp(viewModel: MainViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()

    MaterialTheme(colorScheme = DarkColorScheme) {
        Scaffold(
            containerColor = BgPrimary,
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text("⚡ WakeMaster", fontWeight = FontWeight.Bold, fontSize = 20.sp)
                            Text("LAN Machine Manager", color = TextMuted, fontSize = 12.sp)
                        }
                    },
                    actions = {
                        // Scan button
                        IconButton(onClick = { viewModel.startScan() }) {
                            Icon(Icons.Default.Wifi, "Scan LAN", tint = Accent)
                        }
                        // Refresh button
                        IconButton(onClick = { viewModel.refreshStatus() }) {
                            Icon(Icons.Default.Refresh, "Refresh", tint = TextSecondary)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = BgSecondary)
                )
            },
            floatingActionButton = {
                var showDialog by remember { mutableStateOf(false) }
                FloatingActionButton(
                    onClick = { showDialog = true },
                    containerColor = Accent,
                    contentColor = Color.White
                ) {
                    Icon(Icons.Default.Add, "Add Machine")
                }
                if (showDialog) {
                    AddMachineDialog(
                        onDismiss = { showDialog = false },
                        onAdd = { name, mac, ip, icon ->
                            viewModel.addMachine(name, mac, ip, icon)
                            showDialog = false
                        }
                    )
                }
            },
            snackbarHost = {
                state.toastMessage?.let { msg ->
                    Snackbar(
                        modifier = Modifier.padding(16.dp),
                        containerColor = BgSecondary,
                        contentColor = TextPrimary
                    ) { Text(msg) }
                }
            }
        ) { padding ->
            if (state.machines.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize().padding(padding),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("🖧", fontSize = 48.sp)
                        Spacer(Modifier.height(16.dp))
                        Text("No machines yet", color = TextMuted, fontSize = 16.sp)
                        Spacer(Modifier.height(8.dp))
                        Text("Tap + to add or 📡 to scan LAN", color = TextMuted, fontSize = 13.sp)
                    }
                }
            } else {
                DraggableMachineList(
                    machines = state.machines,
                    statusMap = state.statusMap,
                    onWake = { viewModel.wakeMachine(it) },
                    onDelete = { viewModel.deleteMachine(it) },
                    onMove = { from, to -> viewModel.moveMachine(from, to) },
                    modifier = Modifier.fillMaxSize().padding(padding)
                )
            }
        }

        // Scan Dialog
        if (state.showScanDialog) {
            ScanResultsDialog(
                isScanning = state.isScanning,
                progress = state.scanProgress,
                results = state.scanResults,
                isMacAdded = { viewModel.isMacAlreadyAdded(it) },
                onAdd = { viewModel.addScannedDevice(it) },
                onDismiss = { viewModel.dismissScanDialog() }
            )
        }
    }
}

// === Draggable Machine List ===

@Composable
fun DraggableMachineList(
    machines: List<Machine>,
    statusMap: Map<String, Boolean?>,
    onWake: (String) -> Unit,
    onDelete: (String) -> Unit,
    onMove: (Int, Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()

    // Drag state
    var draggedIndex by remember { mutableIntStateOf(-1) }
    var dragOffset by remember { mutableFloatStateOf(0f) }
    var currentTargetIndex by remember { mutableIntStateOf(-1) }

    LazyColumn(
        state = listState,
        modifier = modifier,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        itemsIndexed(machines, key = { _, m -> m.id }) { index, machine ->
            val isDragged = draggedIndex == index

            Box(
                modifier = Modifier
                    .zIndex(if (isDragged) 1f else 0f)
                    .graphicsLayer {
                        if (isDragged) {
                            translationY = dragOffset
                            scaleX = 1.03f
                            scaleY = 1.03f
                            alpha = 0.9f
                            shadowElevation = 16f
                        }
                    }
                    .pointerInput(index) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = {
                                draggedIndex = index
                                dragOffset = 0f
                                currentTargetIndex = index
                            },
                            onDrag = { change, dragAmount ->
                                change.consume()
                                dragOffset += dragAmount.y

                                // Calculate target index based on drag position
                                val itemHeight = 200 // approximate card height in px
                                val rawTarget = index + (dragOffset / itemHeight).toInt()
                                val target = rawTarget.coerceIn(0, machines.size - 1)
                                if (target != currentTargetIndex) {
                                    currentTargetIndex = target
                                }
                            },
                            onDragEnd = {
                                if (currentTargetIndex != draggedIndex && currentTargetIndex >= 0) {
                                    onMove(draggedIndex, currentTargetIndex)
                                }
                                draggedIndex = -1
                                dragOffset = 0f
                                currentTargetIndex = -1
                            },
                            onDragCancel = {
                                draggedIndex = -1
                                dragOffset = 0f
                                currentTargetIndex = -1
                            }
                        )
                    }
            ) {
                MachineCard(
                    machine = machine,
                    status = statusMap[machine.id],
                    onWake = { onWake(machine.id) },
                    onDelete = { onDelete(machine.id) }
                )
            }
        }
    }
}

// === Machine Card ===

@Composable
fun MachineCard(
    machine: Machine,
    status: Boolean?,
    onWake: () -> Unit,
    onDelete: () -> Unit
) {
    val borderColor = when (status) {
        true -> Green.copy(alpha = 0.3f)
        false -> TextMuted.copy(alpha = 0.1f)
        null -> Orange.copy(alpha = 0.2f)
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = BgCard),
        border = androidx.compose.foundation.BorderStroke(1.dp, borderColor)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            // Header: icon + name + delete
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(machine.icon, fontSize = 28.sp)
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(machine.name, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = TextPrimary)
                    Text(machine.mac, fontSize = 11.sp, color = TextMuted,
                        fontFamily = FontFamily.Monospace)
                }
                IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Default.Delete, "Delete", tint = TextMuted, modifier = Modifier.size(18.dp))
                }
            }

            Spacer(Modifier.height(12.dp))

            // Status
            val (statusBg, statusDot, statusText) = when (status) {
                true -> Triple(GreenBg, Green, "Online")
                false -> Triple(GrayBg, TextMuted, "Offline")
                null -> Triple(OrangeBg, Orange, "Checking...")
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(statusBg)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier.size(8.dp).clip(CircleShape).background(statusDot)
                )
                Spacer(Modifier.width(8.dp))
                Text(statusText, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = statusDot)
            }

            Spacer(Modifier.height(8.dp))

            // IP + drag hint
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("IP: ${machine.ip}", fontSize = 12.sp, color = TextMuted, fontFamily = FontFamily.Monospace)
                Text("⠿ 长按拖拽排序", fontSize = 10.sp, color = TextMuted.copy(alpha = 0.5f))
            }

            Spacer(Modifier.height(12.dp))

            // Wake button — always enabled
            Button(
                onClick = onWake,
                modifier = Modifier.fillMaxWidth().height(44.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                )
            ) {
                Text("⚡ Wake", fontWeight = FontWeight.Medium)
            }
        }
    }
}

// === Scan Results Dialog ===

@Composable
fun ScanResultsDialog(
    isScanning: Boolean,
    progress: Float,
    results: List<ScannedDevice>,
    isMacAdded: (String) -> Boolean,
    onAdd: (ScannedDevice) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = { if (!isScanning) onDismiss() },
        containerColor = BgSecondary,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("📡 ", fontSize = 20.sp)
                Text("LAN Scan", fontWeight = FontWeight.SemiBold)
            }
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                if (isScanning) {
                    Text("Scanning network...", color = TextSecondary, fontSize = 13.sp)
                    Spacer(Modifier.height(12.dp))
                    LinearProgressIndicator(
                        progress = progress,
                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                        color = Accent,
                        trackColor = GrayBg,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "${(progress * 100).toInt()}%",
                        color = TextMuted,
                        fontSize = 12.sp,
                        modifier = Modifier.align(Alignment.End)
                    )
                } else if (results.isEmpty()) {
                    Text("No devices found on the network.",
                        color = TextSecondary, fontSize = 14.sp)
                } else {
                    Text(
                        "Found ${results.size} device(s)",
                        color = Green,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium
                    )
                    Spacer(Modifier.height(12.dp))

                    // Results list
                    LazyColumn(
                        modifier = Modifier.heightIn(max = 380.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(results) { device ->
                            val alreadyAdded = isMacAdded(device.mac)
                            ScanResultItem(
                                device = device,
                                alreadyAdded = alreadyAdded,
                                onAdd = { onAdd(device) }
                            )
                        }
                    }

                    // Add All button
                    val unadded = results.filter { !isMacAdded(it.mac) }
                    if (unadded.isNotEmpty()) {
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(
                            onClick = { unadded.forEach { onAdd(it) } },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Accent.copy(alpha = 0.5f))
                        ) {
                            Text("➕ Add All (${unadded.size})", color = Accent)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(if (isScanning) "Cancel" else "Close", color = TextSecondary)
            }
        },
        dismissButton = null
    )
}

@Composable
fun ScanResultItem(
    device: ScannedDevice,
    alreadyAdded: Boolean,
    onAdd: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (alreadyAdded) GrayBg.copy(alpha = 0.3f) else GrayBg)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                device.hostname.ifEmpty { "Unknown Device" },
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                color = if (alreadyAdded) TextMuted else TextPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                "${device.ip}  •  ${device.mac}",
                fontSize = 11.sp,
                color = TextMuted,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Spacer(Modifier.width(8.dp))
        if (alreadyAdded) {
            Text("✓ Added", fontSize = 12.sp, color = Green.copy(alpha = 0.6f))
        } else {
            FilledTonalButton(
                onClick = onAdd,
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.filledTonalButtonColors(
                    containerColor = Accent.copy(alpha = 0.15f),
                    contentColor = Accent
                ),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)
            ) {
                Text("+ Add", fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

// === Add Machine Dialog ===

@Composable
fun AddMachineDialog(
    onDismiss: () -> Unit,
    onAdd: (name: String, mac: String, ip: String, icon: String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var mac by remember { mutableStateOf("") }
    var ip by remember { mutableStateOf("") }
    val icon = "🖥️"

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgSecondary,
        title = { Text("Add Machine", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text("Host Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = mac, onValueChange = { mac = it },
                    label = { Text("MAC Address") },
                    placeholder = { Text("支持 : - 空格 分隔", color = TextMuted) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = ip, onValueChange = { ip = it },
                    label = { Text("IP Address") },
                    placeholder = { Text("192.168.0.100", color = TextMuted) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { if (name.isNotBlank() && mac.isNotBlank() && ip.isNotBlank()) onAdd(name, normalizeMac(mac), ip, icon) },
                colors = ButtonDefaults.buttonColors(containerColor = Accent)
            ) { Text("Add") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = TextSecondary) }
        }
    )
}

// === MAC Address Normalization ===
fun normalizeMac(input: String): String {
    val raw = input.replace(Regex("[:\\-\\s.]"), "").uppercase()
    if (!raw.matches(Regex("^[0-9A-F]{12}$"))) return input
    return raw.chunked(2).joinToString(":")
}
