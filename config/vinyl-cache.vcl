vcl 4.1;

backend default none;

backend bc {
    .host = "127.0.0.1";
    .port = "13599";
}

sub vcl_recv {
    if (req.http.host == "bc.godfat.org") {
        set req.backend_hint = bc;
        set req.http.Cache-Control = "max-age=600";
        unset req.http.Cookie;
    }

    if (req.http.referer &&
        req.http.referer ~ "\b(t\.co|twitter\.com|x\.com|facebook\.com|youtube\.com)\b") {
        return (pass);
    }
}

sub vcl_backend_response {
    set beresp.ttl = 10m;
}

sub vcl_deliver {
    set resp.http.Cache-Control = "public, max-age=600";
}
