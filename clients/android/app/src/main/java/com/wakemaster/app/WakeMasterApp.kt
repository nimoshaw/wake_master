package com.wakemaster.app

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel

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
                        Text("Tap + to add your first machine", color = TextMuted, fontSize = 13.sp)
                    }
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(300.dp),
                    modifier = Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(state.machines) { machine ->
                        MachineCard(
                            machine = machine,
                            status = state.statusMap[machine.id],
                            onWake = { viewModel.wakeMachine(machine.id) },
                            onDelete = { viewModel.deleteMachine(machine.id) }
                        )
                    }
                }
            }
        }
    }
}

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

            // IP
            Text("IP: ${machine.ip}", fontSize = 12.sp, color = TextMuted, fontFamily = FontFamily.Monospace)

            Spacer(Modifier.height(12.dp))

            // Wake button
            Button(
                onClick = onWake,
                enabled = status != true,
                modifier = Modifier.fillMaxWidth().height(44.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                    disabledContainerColor = Accent.copy(alpha = 0.3f)
                )
            ) {
                Text("⚡ Wake", fontWeight = FontWeight.Medium)
            }
        }
    }
}

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
