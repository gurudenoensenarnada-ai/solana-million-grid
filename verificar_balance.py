#!/usr/bin/env python3
"""
Script de diagnóstico para verificar balance de wallet Solana
Prueba múltiples RPCs y muestra información detallada
"""

import requests
import json
import time
from typing import Optional, Tuple

# Lista de RPCs públicos de Solana Mainnet
RPC_ENDPOINTS = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-api.projectserum.com",
    "https://rpc.ankr.com/solana",
    "https://api.mainnet.solana.com",
]

LAMPORTS_PER_SOL = 1_000_000_000

def check_balance(wallet_address: str, rpc_url: str, timeout: int = 10) -> Optional[Tuple[int, float]]:
    """
    Verifica el balance de una wallet en Solana
    
    Args:
        wallet_address: Dirección de la wallet pública
        rpc_url: URL del RPC endpoint
        timeout: Timeout en segundos
    
    Returns:
        Tuple de (balance_lamports, balance_sol) o None si falla
    """
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getBalance",
        "params": [wallet_address]
    }
    
    headers = {
        "Content-Type": "application/json"
    }
    
    try:
        print(f"\n🔄 Probando RPC: {rpc_url}")
        start_time = time.time()
        
        response = requests.post(
            rpc_url,
            json=payload,
            headers=headers,
            timeout=timeout
        )
        
        elapsed_time = time.time() - start_time
        
        if response.status_code == 200:
            data = response.json()
            
            if "result" in data and "value" in data["result"]:
                balance_lamports = data["result"]["value"]
                balance_sol = balance_lamports / LAMPORTS_PER_SOL
                
                print(f"✅ RPC funcionando ({elapsed_time:.2f}s)")
                print(f"   Balance: {balance_sol:.9f} SOL")
                print(f"   Lamports: {balance_lamports:,}")
                
                return balance_lamports, balance_sol
            else:
                print(f"❌ Respuesta sin 'result' válido")
                print(f"   Respuesta: {json.dumps(data, indent=2)}")
                return None
        else:
            print(f"❌ Error HTTP {response.status_code}")
            return None
            
    except requests.exceptions.Timeout:
        print(f"⏱️ Timeout después de {timeout}s")
        return None
    except requests.exceptions.RequestException as e:
        print(f"❌ Error de conexión: {str(e)}")
        return None
    except Exception as e:
        print(f"❌ Error inesperado: {str(e)}")
        return None

def check_wallet_in_explorer(wallet_address: str):
    """Genera enlaces a exploradores de blockchain"""
    print(f"\n🔗 Enlaces para verificar tu wallet:")
    print(f"   Solana Explorer: https://explorer.solana.com/address/{wallet_address}")
    print(f"   Solscan: https://solscan.io/account/{wallet_address}")
    print(f"   Solana Beach: https://solanabeach.io/address/{wallet_address}")

def estimate_fees(num_blocks: int, price_per_block: float = 0.001) -> dict:
    """Estima el costo total incluyendo fees"""
    total_price = num_blocks * price_per_block
    estimated_fee = 0.000005  # Fee típico en SOL
    total_needed = total_price + estimated_fee
    
    return {
        "blocks": num_blocks,
        "price_per_block": price_per_block,
        "subtotal": total_price,
        "estimated_fee": estimated_fee,
        "total": total_needed
    }

def main():
    print("=" * 70)
    print("🔍 DIAGNÓSTICO DE BALANCE DE WALLET SOLANA")
    print("=" * 70)
    
    # Solicitar dirección de wallet
    wallet_address = input("\n📍 Ingresa tu dirección de wallet (pública): ").strip()
    
    if not wallet_address:
        print("❌ Dirección de wallet vacía")
        return
    
    # Validación básica de formato (Solana addresses son base58, ~32-44 caracteres)
    if len(wallet_address) < 32 or len(wallet_address) > 44:
        print("⚠️ Advertencia: La dirección parece tener longitud inválida")
        continuar = input("¿Continuar de todos modos? (s/n): ")
        if continuar.lower() != 's':
            return
    
    print(f"\n💼 Wallet: {wallet_address}")
    
    # Verificar balance en múltiples RPCs
    balances = []
    working_rpcs = []
    
    for rpc_url in RPC_ENDPOINTS:
        result = check_balance(wallet_address, rpc_url)
        if result:
            balances.append(result)
            working_rpcs.append(rpc_url)
            time.sleep(0.5)  # Pequeña pausa entre requests
    
    # Resumen de resultados
    print("\n" + "=" * 70)
    print("📊 RESUMEN DE RESULTADOS")
    print("=" * 70)
    
    if not balances:
        print("\n❌ No se pudo obtener el balance desde ningún RPC")
        print("\nPosibles causas:")
        print("   1. Dirección de wallet incorrecta")
        print("   2. Problemas de conexión a internet")
        print("   3. RPCs públicos temporalmente saturados")
        print("\n💡 Sugerencia: Verifica tu wallet en Phantom o en los exploradores")
        check_wallet_in_explorer(wallet_address)
        return
    
    # Calcular estadísticas
    balance_values = [b[1] for b in balances]
    avg_balance = sum(balance_values) / len(balance_values)
    min_balance = min(balance_values)
    max_balance = max(balance_values)
    
    print(f"\n✅ RPCs funcionando: {len(working_rpcs)}/{len(RPC_ENDPOINTS)}")
    print(f"\n💰 Balance promedio: {avg_balance:.9f} SOL")
    
    if len(set(balance_values)) > 1:
        print(f"   Rango: {min_balance:.9f} - {max_balance:.9f} SOL")
        print("   ⚠️ Los RPCs reportan balances ligeramente diferentes (normal)")
    
    # Estimación de compras
    print("\n" + "=" * 70)
    print("💳 ESTIMACIÓN DE COMPRAS POSIBLES")
    print("=" * 70)
    
    if avg_balance == 0:
        print("\n⚠️ Balance actual: 0 SOL")
        print("   No puedes realizar compras sin fondos")
        print("\n💡 Para agregar SOL a tu wallet:")
        print("   1. Compra SOL en un exchange (Binance, Coinbase, etc.)")
        print("   2. Envía a tu dirección de Phantom")
        print("   3. Espera la confirmación (~1-2 minutos)")
    else:
        print(f"\n💰 Balance disponible: {avg_balance:.9f} SOL")
        print("\nEjemplos de compras posibles:")
        
        examples = [1, 10, 25, 50, 100]
        for num_blocks in examples:
            estimate = estimate_fees(num_blocks)
            
            if estimate["total"] <= avg_balance:
                status = "✅"
            else:
                status = "❌"
            
            print(f"\n   {status} {num_blocks} bloques:")
            print(f"      Precio: {estimate['subtotal']:.6f} SOL")
            print(f"      Fee: {estimate['estimated_fee']:.6f} SOL")
            print(f"      Total: {estimate['total']:.6f} SOL")
    
    # Enlaces a exploradores
    check_wallet_in_explorer(wallet_address)
    
    print("\n" + "=" * 70)
    print("✅ Diagnóstico completado")
    print("=" * 70)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⏸️ Operación cancelada por el usuario")
    except Exception as e:
        print(f"\n\n❌ Error inesperado: {str(e)}")
        import traceback
        traceback.print_exc()
