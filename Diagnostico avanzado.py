#!/usr/bin/env python3
"""
Script de diagnóstico avanzado para el problema de conexión RPC
"""

import requests
import json
import time

# RPCs que usa tu aplicación
RPC_ENDPOINTS = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-api.projectserum.com", 
    "https://rpc.ankr.com/solana",
    "https://api.mainnet-beta.solana.com"  # clusterApiUrl default
]

print("="*70)
print("🔍 DIAGNÓSTICO AVANZADO DE CONEXIÓN RPC SOLANA")
print("="*70)

def test_rpc_basic(rpc_url):
    """Test básico de conectividad"""
    print(f"\n🔄 Probando: {rpc_url}")
    
    # Test 1: Conectividad básica
    try:
        response = requests.get(rpc_url, timeout=5)
        print(f"   ✅ Servidor responde (HTTP {response.status_code})")
    except requests.exceptions.Timeout:
        print(f"   ❌ Timeout al conectar")
        return False
    except requests.exceptions.ConnectionError as e:
        print(f"   ❌ Error de conexión: {str(e)[:50]}")
        return False
    except Exception as e:
        print(f"   ⚠️ Error: {str(e)[:50]}")
        
    # Test 2: Llamada RPC real
    try:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getHealth"
        }
        
        response = requests.post(
            rpc_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            if "result" in data:
                print(f"   ✅ RPC funcional: {data['result']}")
                return True
            elif "error" in data:
                print(f"   ❌ Error RPC: {data['error']}")
                return False
        else:
            print(f"   ❌ HTTP Error: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"   ❌ Error en llamada RPC: {str(e)}")
        return False

def test_get_balance(rpc_url, wallet_address):
    """Test de obtención de balance"""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getBalance",
        "params": [wallet_address]
    }
    
    try:
        response = requests.post(
            rpc_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            if "result" in data and "value" in data["result"]:
                balance = data["result"]["value"] / 1_000_000_000
                print(f"   💰 Balance obtenido: {balance:.9f} SOL")
                return True
        return False
    except:
        return False

print("\n" + "="*70)
print("TEST 1: CONECTIVIDAD BÁSICA")
print("="*70)

working_rpcs = []
for rpc in RPC_ENDPOINTS:
    if test_rpc_basic(rpc):
        working_rpcs.append(rpc)
    time.sleep(0.5)

print("\n" + "="*70)
print("📊 RESULTADOS")
print("="*70)

if working_rpcs:
    print(f"\n✅ {len(working_rpcs)}/{len(RPC_ENDPOINTS)} RPCs funcionando:")
    for rpc in working_rpcs:
        print(f"   • {rpc}")
else:
    print("\n❌ NINGÚN RPC FUNCIONA")
    print("\nPosibles causas:")
    print("   1. Tu firewall está bloqueando conexiones a Solana")
    print("   2. Tu ISP está bloqueando estos servidores")
    print("   3. Estás detrás de un proxy/VPN restrictivo")
    print("   4. Problema temporal con los servidores de Solana")

# Test con wallet si proporcionada
print("\n" + "="*70)
print("TEST 2: OBTENCIÓN DE BALANCE (Opcional)")
print("="*70)

wallet_input = input("\n📍 Ingresa tu wallet address (Enter para omitir): ").strip()

if wallet_input and working_rpcs:
    print("\n🔍 Intentando obtener balance...")
    for rpc in working_rpcs:
        print(f"\n   Usando: {rpc[:50]}...")
        if test_get_balance(rpc, wallet_input):
            print(f"   ✅ Balance obtenido exitosamente")
            break
        else:
            print(f"   ❌ Falló")

# Diagnóstico de red
print("\n" + "="*70)
print("TEST 3: DIAGNÓSTICO DE RED")
print("="*70)

print("\n🔍 Probando conectividad general...")

# Test DNS
print("\n1. Test DNS:")
try:
    import socket
    socket.gethostbyname("api.mainnet-beta.solana.com")
    print("   ✅ DNS funcionando correctamente")
except:
    print("   ❌ Problema con DNS")

# Test HTTP básico
print("\n2. Test HTTP general:")
try:
    response = requests.get("https://www.google.com", timeout=5)
    print("   ✅ Conexión HTTP funcionando")
except:
    print("   ❌ Problema con conexiones HTTP")

# Información de red
print("\n3. Configuración detectada:")
try:
    response = requests.get("https://api.ipify.org?format=json", timeout=5)
    ip_info = response.json()
    print(f"   IP pública: {ip_info.get('ip', 'Desconocida')}")
except:
    print("   ⚠️ No se pudo obtener info de red")

print("\n" + "="*70)
print("💡 RECOMENDACIONES")
print("="*70)

if not working_rpcs:
    print("""
🔥 PROBLEMA CRÍTICO: Ningún RPC funciona

Acciones inmediatas:

1. DESACTIVA VPN (si usas una)
   - VPNs a menudo bloquean acceso a Solana
   - Desconecta y prueba de nuevo

2. VERIFICA FIREWALL
   - Windows: Panel de Control → Firewall → Permitir aplicación
   - Mac: Preferencias → Seguridad → Firewall
   - Agrega excepciones para tu navegador

3. PRUEBA DESDE MÓVIL
   - Usa datos móviles (no WiFi)
   - Si funciona = Problema con tu red

4. PRUEBA OTRO NAVEGADOR
   - Intenta Chrome, Firefox, Edge
   - Modo incógnito primero

5. USA UN RPC PREMIUM (Recomendado)
   - Alchemy: https://www.alchemy.com/solana
   - QuickNode: https://www.quicknode.com/
   - Son gratis hasta cierto límite
""")
else:
    print(f"""
✅ Algunos RPCs funcionan ({len(working_rpcs)}/{len(RPC_ENDPOINTS)})

El problema puede estar en:

1. CORS en el navegador
   - Los RPCs funcionan desde Python
   - Puede fallar en el navegador por CORS
   - Solución: Usa un RPC premium

2. EXTENSIONES DEL NAVEGADOR
   - Bloqueadores de ads pueden interferir
   - Prueba en modo incógnito

3. CONFIGURACIÓN DE PHANTOM
   - Asegúrate de estar en Mainnet Beta
   - No en Devnet o Testnet
""")

print("\n" + "="*70)
print("🎯 SIGUIENTE PASO RECOMENDADO")
print("="*70)

if not working_rpcs:
    print("""
Como NINGÚN RPC funciona desde Python, el problema es tu red.

Acción #1: DESACTIVA VPN ahora mismo y ejecuta este script de nuevo.
Acción #2: Si no usas VPN, prueba desde otra red (4G/5G).
Acción #3: Contacta a tu ISP si el problema persiste.
""")
else:
    print("""
Los RPCs funcionan desde Python pero fallan en el navegador.

Acción #1: Abre tu app en modo incógnito (sin extensiones).
Acción #2: Verifica que Phantom esté en MAINNET BETA.
Acción #3: Usa un RPC premium (Alchemy recomendado).
""")

print("="*70)
