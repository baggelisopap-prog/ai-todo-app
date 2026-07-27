from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from repository import supabase

security = HTTPBearer()


async def get_current_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """
    Verifies the incoming Supabase session token via Supabase's own
    auth.get_user() method (works regardless of whether the project uses
    the legacy JWT secret or the newer asymmetric signing keys system —
    delegates verification to Supabase itself rather than us implementing
    JWT decoding logic that could break if the signing method changes).
    Returns the authenticated user's ID. Raises 401 if the token is
    missing, invalid, or expired.
    """
    token = credentials.credentials
    try:
        response = supabase.auth.get_user(token)
        if not response or not response.user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token")
        return response.user.id
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired authentication token")
